import * as path from 'path';
import * as util from '@aws-sdk/util-arn-parser';
import * as iam from 'aws-cdk-lib/aws-iam';
import { AssetCode, Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { CometdConfig, project } from './cometd-config';
import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration } from 'aws-cdk-lib';
import { AllowedMethods, LambdaEdgeEventType, PriceClass, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { defineDNSRecords, getDistributionDnsProps } from '../../utils/dns-helpers';
import { AWSAccount, AWSRegion, generateStackResourceName } from '../../config/environments';

@Deployment(project.name, project.name)
export class CometdStack extends RootStack {
  constructor(stackConfig: StackConfig, envConfig: CometdConfig) {
    stackConfig.props = { env: { region: 'us-east-1' } };
    super(stackConfig);

    const codePath = path.resolve(project.path, 'dist/code');

    // This is assets with the lambda code
    const code = Code.fromAsset(codePath);

    const originRequestLambda = this.createLambdaFunction('origin-request', code, 'origin-request/index.handler');
    const originResponseLambda = this.createLambdaFunction('origin-response', code, 'origin-response/index.handler');
    originRequestLambda.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [
          util.build({
            service: 'secretsmanager',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `secret:${envConfig.serviceUserSecretName}-??????`,
          }),
        ],
        actions: ['secretsmanager:GetSecretValue'],
      }),
    );

    const commonBehaviourProps = {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: false,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      allowedMethods: AllowedMethods.ALLOW_ALL,
    };

    const edgeLambdas = [
      {
        functionVersion: originRequestLambda,
        eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
      },
      {
        functionVersion: originResponseLambda,
        eventType: LambdaEdgeEventType.ORIGIN_RESPONSE,
      },
    ];

    const cometdOriginProps = {
      customHeaders: {
        'X-Crossover-SecretName': envConfig.serviceUserSecretName,
        'X-Crossover-SalesforceAuthApi': `https://${envConfig.salesforceDomainName}/services/oauth2`,
      },
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      keepaliveTimeout: Duration.seconds(120),
      readTimeout: Duration.seconds(120),
    };

    const distr = new cloudfront.Distribution(this, 'distr', {
      defaultBehavior: {
        origin: new origins.HttpOrigin(envConfig.crossoverDomainName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        }),
        ...commonBehaviourProps,
      },
      additionalBehaviors: {
        'cometd/rev2*': {
          origin: new origins.HttpOrigin(envConfig.salesforceDomainName, {
            originPath: '/cometd/59.0',
            ...cometdOriginProps,
          }),
          edgeLambdas: edgeLambdas,
          ...commonBehaviourProps,
        },
        'cometd/*': {
          origin: new origins.HttpOrigin(envConfig.salesforceDomainName, {
            originPath: '/cometd/59.0',
            ...cometdOriginProps,
          }),
          edgeLambdas: edgeLambdas,
          ...commonBehaviourProps,
        },
      },
      priceClass: PriceClass.PRICE_CLASS_ALL,
      ...getDistributionDnsProps(this, envConfig.dns),
    });

    defineDNSRecords(this, envConfig.dns, distr);
  }

  /**
   *  Create all lambda functions based on the registry
   *  A single shared layer for node modules will be created as well
   *  We also set default env variables here. Specific variables can be set manually later
   */
  private createLambdaFunction(name: string, code: AssetCode, handler: string) {
    return new cloudfront.experimental.EdgeFunction(this, `lambda-${name}`, {
      functionName: generateStackResourceName(this.config, name),
      code: code,
      handler: handler,
      runtime: Runtime.NODEJS_16_X,
    });
  }
}
