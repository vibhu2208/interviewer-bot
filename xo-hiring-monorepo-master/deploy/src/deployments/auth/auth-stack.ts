import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { AuthConfig, project } from './auth-config';
import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { AWSRegion, DefaultDnsConfig, isProduction } from '../../config/environments';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { aws_ses, Duration, SecretValue } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ssmPolicy } from '../../utils/lambda-helpers';
import { UserPoolDomainTarget } from 'aws-cdk-lib/aws-route53-targets';

@Deployment(project.name, project.name)
export class AuthStack extends RootStack {
  private readonly lambdaRole: iam.Role;
  private readonly lambdaCode: lambda.AssetCode;
  private readonly lambdaModules: lambda.LayerVersion;
  private readonly lambdaFn: lambda.Function;

  constructor(stackConfig: StackConfig, envConfig: AuthConfig) {
    super(stackConfig);

    // Generic lambda configuration for a single-project setup
    this.lambdaCode = lambda.Code.fromAsset(path.join(project.path, 'dist/code'));
    this.lambdaModules = new lambda.LayerVersion(this, 'cognito-handler-layer', {
      code: lambda.Code.fromAsset(path.join(project.path, 'dist/layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    });
    this.lambdaRole = new iam.Role(this, 'cognito-handler-lambda-execution-role', {
      roleName: this.config.generateName('cognito-lambda-execution'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    this.lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );
    // Allow to write and read the salesforce authorizer from SSM
    this.lambdaRole.addToPolicy(ssmPolicy(stackConfig.environmentName));
    // Add it here to avoid circular dependency between Cognito and Trigger Lambda
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: [
          'cognito-idp:ListUsers',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminLinkProviderForUser',
        ],
      }),
    );
    this.lambdaRole.addToPolicy(ssmPolicy(stackConfig.environmentName));
    if (stackConfig.environmentName.startsWith('pr')) {
      // Add SSM permissions for sandbox vars when running preview envs
      this.lambdaRole.addToPolicy(ssmPolicy('sandbox'));
    }

    this.lambdaFn = new lambda.Function(this, 'cognito-handler-lambda', {
      functionName: this.config.generateName(`cognito-event-handler`).slice(0, 64),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'cognito-event-handler.handleCognitoEvent',
      code: this.lambdaCode,
      layers: [this.lambdaModules],
      role: this.lambdaRole,
      timeout: Duration.minutes(1),
      memorySize: 256,
      environment: {
        ENV: this.config.environmentName,
        TRUSTED_SOURCES: envConfig.trustedSources.join(','),
      },
    });

    this.addCognito(stackConfig, envConfig);
  }

  /**
   *  Create user pool, app client and configure lambda triggers
   */
  private addCognito(stackConfig: StackConfig, envConfig: AuthConfig) {
    const configSet = new aws_ses.CfnConfigurationSet(this, stackConfig.generateLogicalId('config-set'), {
      name: stackConfig.generateName('config-set'),
      deliveryOptions: {
        tlsPolicy: 'OPTIONAL',
      },
      sendingOptions: {
        sendingEnabled: true,
      },
      reputationOptions: {
        reputationMetricsEnabled: true,
      },
    });
    const userPool = new cognito.UserPool(this, stackConfig.generateLogicalId('user-pool'), {
      userPoolName: stackConfig.generateName('user-pool'),
      selfSignUpEnabled: true,
      signInAliases: {
        username: true,
        email: true,
        phone: true,
        preferredUsername: false,
      },
      autoVerify: {
        email: true,
        phone: false,
      },
      keepOriginal: {
        email: true,
        phone: false,
      },
      signInCaseSensitive: true,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email: {
          mutable: true,
          required: true,
        },
        givenName: {
          mutable: true,
          required: true,
        },
        familyName: {
          mutable: true,
          required: true,
        },
        phoneNumber: {
          mutable: true,
          required: true,
        },
      },
      email: cognito.UserPoolEmail.withSES({
        sesRegion: AWSRegion,
        fromEmail: 'verify@crossover.com',
        fromName: 'Crossover - Verify',
        configurationSetName: configSet.name,
      }),
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
        emailSubject: `Here's your verification code`,
        emailBody: `Your 6-digit verification code is {####}`,
        smsMessage: `Your 6-digit verification code is {####}`,
      },
      lambdaTriggers: {
        preSignUp: this.lambdaFn,
        preAuthentication: this.lambdaFn,
        postAuthentication: this.lambdaFn,
        postConfirmation: this.lambdaFn,
        userMigration: this.lambdaFn,
      },
    });

    const customAuthDomainName = envConfig.cognitoDomain(stackConfig.environmentName);
    if (customAuthDomainName != null) {
      const domainCertificate = Certificate.fromCertificateArn(
        this,
        'auth-domain-certificate',
        DefaultDnsConfig.viewerCertificateArn,
      );

      // Use custom domain (if configured) for better UX (it will be shown to the candidate when approving SSO instead of cognito domain)
      const userPoolDomain = userPool.addDomain('hosted-ui', {
        customDomain: {
          domainName: customAuthDomainName,
          certificate: domainCertificate,
        },
      });

      // Cognito does not create Route53 records automatically
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'auth-hosted-zone', {
        hostedZoneId: DefaultDnsConfig.hostedZoneId,
        zoneName: DefaultDnsConfig.hostedZoneName,
      });
      new ARecord(this, 'auth-domain-alias-record', {
        zone: hostedZone,
        recordName: customAuthDomainName.split('.')[0], // Get subdomain
        target: RecordTarget.fromAlias(new UserPoolDomainTarget(userPoolDomain)),
      });
    } else {
      userPool.addDomain('hosted-ui', {
        cognitoDomain: {
          domainPrefix: `crossover-hire-candidate-${stackConfig.environmentName}`,
        },
      });
    }

    // SSO Providers
    const googleProvider = new cognito.UserPoolIdentityProviderOidc(this, 'candidate-cognito-google-provider', {
      userPool,
      name: 'google',
      endpoints: {
        token: 'https://oauth2.googleapis.com/token',
        authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
        jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
        userInfo: `${envConfig.userInfoProxyUrl}/google/userinfo`,
      },
      issuerUrl: 'https://accounts.google.com',
      clientId: SecretValue.secretsManager(envConfig.googleOAuthSecretName, {
        jsonField: 'clientId',
      }).unsafeUnwrap(),
      clientSecret: SecretValue.secretsManager(envConfig.googleOAuthSecretName, {
        jsonField: 'clientSecret',
      }).unsafeUnwrap(),
      scopes: ['profile', 'email', 'openid'],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
        phoneNumber: cognito.ProviderAttribute.other('phone_number'),
        emailVerified: cognito.ProviderAttribute.other('email_verified'),
      },
    });
    const linkedInProvider = new cognito.UserPoolIdentityProviderOidc(this, 'candidate-cognito-linkedin-provider', {
      userPool,
      name: 'linkedin',
      endpoints: {
        token: 'https://www.linkedin.com/oauth/v2/accessToken',
        authorization: 'https://www.linkedin.com/oauth/v2/authorization',
        jwksUri: 'https://www.linkedin.com/oauth/openid/jwks',
        userInfo: `${envConfig.userInfoProxyUrl}/linkedin/userinfo`,
      },
      issuerUrl: 'https://www.linkedin.com/oauth',
      clientId: SecretValue.secretsManager(envConfig.linkedinOAuthSecretName, {
        jsonField: 'clientId',
      }).unsafeUnwrap(),
      clientSecret: SecretValue.secretsManager(envConfig.linkedinOAuthSecretName, {
        jsonField: 'clientSecret',
      }).unsafeUnwrap(),
      scopes: ['profile', 'email', 'openid'],
      attributeMapping: {
        email: cognito.ProviderAttribute.other('email'),
        givenName: cognito.ProviderAttribute.other('given_name'),
        familyName: cognito.ProviderAttribute.other('family_name'),
        profilePicture: cognito.ProviderAttribute.other('picture'),
        phoneNumber: cognito.ProviderAttribute.other('phone_number'),
        emailVerified: cognito.ProviderAttribute.other('email_verified'),
      },
    });

    const callbackUrls: string[] = envConfig.frontendCandidateDomains.map((it) => `${it}/auth/login`);
    const logoutUrls: string[] = envConfig.frontendCandidateDomains.map((it) => `${it}/auth/login`);

    const client = userPool.addClient('app-client', {
      userPoolClientName: 'Candidate Portal',
      generateSecret: false,
      preventUserExistenceErrors: false,
      enableTokenRevocation: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
        callbackUrls,
        logoutUrls,
      },
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        givenName: true,
        familyName: true,
        phoneNumber: true,
      }),
      accessTokenValidity: Duration.days(1),
      idTokenValidity: Duration.days(1),
      refreshTokenValidity: Duration.days(30),
    });

    // Make sure providers are deployed before the client
    client.node.addDependency(googleProvider);
    client.node.addDependency(linkedInProvider);

    const clientAdmin = userPool.addClient('app-client-admin', {
      userPoolClientName: 'Candidate Portal Server Admin',
      generateSecret: false,
      preventUserExistenceErrors: false,
      enableTokenRevocation: false,
      authFlows: {
        adminUserPassword: true,
      },
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        givenName: true,
        familyName: true,
        phoneNumber: true,
      }),
    });

    this.addOutput('CognitoUserPoolId', userPool.userPoolId);
    this.addOutput('ClientId', client.userPoolClientId);
    this.addOutput('AdminClientId', clientAdmin.userPoolClientId);
  }
}
