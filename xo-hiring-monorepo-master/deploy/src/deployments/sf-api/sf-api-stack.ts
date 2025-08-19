import {
  declareLambda,
  Deployment,
  InfraLambdaFunction,
  RootStack,
  StackConfig,
} from '@trilogy-group/lambda-cdk-infra';
import { Duration, StringConcat } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { AWSAccount, AWSRegion, PreviewEnvName, ProductionEnvName } from '../../config/environments';
import { ssmPolicy } from '../../utils/lambda-helpers';
import { ActionCallerStack } from './action-caller-stack';
import { AiDataStack } from './ai-data-stack';
import { ApiProxyStack } from './api-proxy-stack';
import { CognitoUsersStack } from './cognito-users-stack';
import { project, SfApiEnvironmentConfiguration } from './sf-api-config';
import { getSsmValue } from '../../config/environments';

export const LambdasRegistry = {
  RequireFinalizeSignUpLambda: declareLambda('require-finalize-sign-up/index.handler'),
  AuthLambda: declareLambda('auth/index.handler'),
};

@Deployment(project.name, project.name)
export class SfApiStack extends RootStack {
  constructor(stackConfig: StackConfig, config: SfApiEnvironmentConfiguration) {
    stackConfig.props = {
      env: {
        account: AWSAccount,
        region: AWSRegion,
      },
    };
    super(stackConfig);

    const userPoolId = config.authConfig.userPoolId;

    this.createLambdaFunctions(stackConfig, config);

    const isPreview = PreviewEnvName.test(stackConfig.environmentName);

    // action-caller lambda
    const actionCallerStack = new ActionCallerStack(this, 'action-caller-stack', {
      config: stackConfig,
      ssmParameters: {
        config: config.actionCaller.getSsmConfigParameter(stackConfig.environmentName),
        serviceAccount: config.actionCaller.getSsmServiceAccountParameter(stackConfig.environmentName),
      },
      failureSnsTopic: config.actionCaller.failureSnsTopic,
      isPreview,
    });

    // predefined cognito users and groups
    // preview environments need prefix for usernames to be unique
    // CAUTION: when updating the password, make sure to recreate the cognito-users stack as well
    const prefix = isPreview ? `${stackConfig.environmentName}_` : '';
    const adminGroupName = `${prefix}admin`;
    const hmGroupName = `${prefix}hm`;

    new CognitoUsersStack(this, 'cognito-users', {
      userPoolId,
      config: stackConfig,
      groups: [adminGroupName, hmGroupName],
    });

    const aiDataStack = new AiDataStack(this, 'ai-data-stack', {
      stackConfig,
      config,
    });

    // api-proxy lambda
    new ApiProxyStack(
      this,
      'api-proxy-stack',
      {
        ...config.api,
        stackConfig: stackConfig,
        actionCaller: actionCallerStack.func,
        authLambda: LambdasRegistry.AuthLambda.fn(),
        requireFinalizeSignUpLambda: LambdasRegistry.RequireFinalizeSignUpLambda.fn(),
        uploadAvatarLambda: lambda.Function.fromFunctionName(
          this,
          'uploadAvatarLambda',
          config.api.uploadAvatarLambdaName,
        ),
        jobSlotXMLPublishingLambda: lambda.Function.fromFunctionName(
          this,
          'jobSlotXMLPublishingLambda',
          config.api.jobSlotXMLPublishingLambdaName,
        ),
        userPoolId,
        // allow sandbox staff users to work with previews
        readonlyGroupNames: isPreview ? [hmGroupName, 'hm'] : [hmGroupName],
        fullAccessGroupNames: isPreview ? [adminGroupName, 'admin'] : [adminGroupName],
        production: stackConfig.environmentName === ProductionEnvName,
        isPreview,
        openaiSecretName: config.openaiSecretName,
        kontentSecretName: config.kontentSecretName,
        linkedInSecretName: config.linkedInSecretName,
        zendeskSecretName: config.zendeskSecretName,
        salesforceBaseUrl: config.salesforceBaseUrl,
        xoHireUploadsS3Bucket: config.xoHireUploadsS3Bucket,
        jobRecommenderBaseUrl: config.jobRecommenderBaseUrl,
        aiDataTable: aiDataStack.aiDataTable,
      },
      config,
    );
  }

  /**
   *  Create all lambda functions based on the registry
   *  A single shared layer for node modules will be created as well
   */
  private createLambdaFunctions(stackConfig: StackConfig, envConfig: SfApiEnvironmentConfiguration): void {
    const layerPath = path.resolve(project.path, 'dist/layer');
    const codePath = path.resolve(project.path, 'dist/code');
    // Create lambda layer with node_modules
    const modulesLayer = new LayerVersion(this, 'node_modules_layer', {
      code: Code.fromAsset(layerPath),
      compatibleRuntimes: [Runtime.NODEJS_18_X],
    });
    // This is assets with the lambda code
    const code = Code.fromAsset(codePath);

    // Now create lambdas
    Object.values(LambdasRegistry).forEach((declaration) => {
      declaration.setFunction(
        InfraLambdaFunction.forRootStack(this, {
          ...declaration.props,
          handler: declaration.handler,
          layers: [modulesLayer],
          code,
          timeout: Duration.seconds(30),
          memorySize: 256,
          runtime: Runtime.NODEJS_18_X,
        }),
      );

      // permissions to invoke lambda
      declaration.fn().grantInvoke(new ServicePrincipal('apigateway.amazonaws.com'));

      declaration.fn().addToRolePolicy(ssmPolicy(stackConfig.environmentName));

      declaration
        .fn()
        .addEnvironment('ENV', stackConfig.environmentName)
        .addEnvironment('SF_URL', envConfig.authConfig.sfUrl)
        .addEnvironment('SF_API_VERSION', envConfig.authConfig.sfApiVersion);
    });

    // lambda permissions
    const cognitoPolicy = new iam.PolicyStatement();
    cognitoPolicy.addResources(`arn:aws:cognito-idp:*:*:userpool/${envConfig.authConfig.userPoolId}`);
    cognitoPolicy.addActions('cognito-idp:listUsers');
    cognitoPolicy.effect = iam.Effect.ALLOW;
    LambdasRegistry.RequireFinalizeSignUpLambda.fn().addToRolePolicy(cognitoPolicy);

    LambdasRegistry.RequireFinalizeSignUpLambda.fn().addEnvironment('USER_POOL_ID', envConfig.authConfig.userPoolId);

    const cognitoPolicyForAuthLambda = new iam.PolicyStatement();
    cognitoPolicyForAuthLambda.addResources(`arn:aws:cognito-idp:*:*:userpool/${envConfig.authConfig.userPoolId}`);
    cognitoPolicyForAuthLambda.addActions('cognito-idp:confirmForgotPassword');
    cognitoPolicyForAuthLambda.addActions('cognito-idp:confirmSignUp');
    cognitoPolicyForAuthLambda.addActions('cognito-idp:forgotPassword');
    cognitoPolicyForAuthLambda.addActions('cognito-idp:listUsers');
    cognitoPolicyForAuthLambda.addActions('cognito-idp:initiateAuth');
    cognitoPolicyForAuthLambda.addActions('cognito-idp:getUserAttributeVerificationCode');
    cognitoPolicyForAuthLambda.addActions('cognito-idp:resendConfirmationCode');
    cognitoPolicyForAuthLambda.addActions('cognito-idp:verifyUserAttribute');
    cognitoPolicyForAuthLambda.addActions('cognito-idp:adminSetUserPassword');
    cognitoPolicyForAuthLambda.effect = iam.Effect.ALLOW;
    LambdasRegistry.AuthLambda.fn().addToRolePolicy(cognitoPolicyForAuthLambda);

    LambdasRegistry.AuthLambda.fn()
      .addEnvironment('USER_POOL_ID', envConfig.authConfig.userPoolId)
      .addEnvironment('CLIENT_ID', envConfig.authConfig.clientId);
  }
}
