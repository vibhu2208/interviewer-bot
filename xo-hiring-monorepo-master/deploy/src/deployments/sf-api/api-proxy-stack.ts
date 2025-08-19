import * as util from '@aws-sdk/util-arn-parser';
import { StackConfig } from '@trilogy-group/lambda-cdk-infra';
import * as cdk from 'aws-cdk-lib';
import { Duration, NestedStack, NestedStackProps, RemovalPolicy } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  ContentHandling,
  EndpointType,
  Integration,
  IntegrationConfig,
  IResource,
  LambdaIntegration,
  LambdaIntegrationOptions,
  Method,
  MethodDeploymentOptions,
  MethodLoggingLevel,
  MethodOptions,
  MockIntegration,
  Model,
  RestApi,
  StageOptions,
} from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import {
  BehaviorOptions,
  CachedMethods,
  CachePolicy,
  ICachePolicy,
  IOrigin,
  PriceClass,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import * as path from 'path';
import {
  AWSAccount,
  AWSRegion,
  FORWARD_ALL,
  FORWARD_X_AUTH_AND_X_HMAC_HEADER_ID,
  generateStackResourceName,
  ORP_NO_HEADERS_ID,
  ProjectName,
} from '../../config/environments';
import { DnsConfig } from '../../config/model';
import { PROJECT_ROOT_PATH } from '../../config/paths';
import { defineDNSRecords, getDistributionDnsProps } from '../../utils/dns-helpers';
import { recaptchaSecretName, secretAccess, ssmPolicy } from '../../utils/lambda-helpers';
import { CachePolicyIdsByTtl, COMPRESSION_ONLY_TTL, MAX_TTL, SfApiEnvironmentConfiguration } from './sf-api-config';

export interface ApiProxyStackProps extends NestedStackProps {
  stackConfig: StackConfig;
  actionCaller: lambda.IFunction;
  authLambda: lambda.IFunction;
  requireFinalizeSignUpLambda: lambda.IFunction;
  uploadAvatarLambda: lambda.IFunction;
  jobSlotXMLPublishingLambda: lambda.IFunction;
  bfqBucket: string;
  kontentSecretName: string;
  linkedInSecretName: string;
  dataTraceEnabled?: boolean;
  metricsEnabled?: boolean;
  apiGwCacheSize: '0.5' | '1.6' | '6.1';
  cachedMethods: [string, number][];
  methodsPolicy: [string, string][];
  dns?: DnsConfig;
  userPoolId: string;
  readonlyGroupNames: string[];
  fullAccessGroupNames: string[];
  production: boolean;
  isPreview: boolean;
  openaiSecretName: string;
  zendeskSecretName: string;
  salesforceBaseUrl: string;
  xoHireUploadsS3Bucket: string;
  jobRecommenderBaseUrl: string;
  aiDataTable: Table;
}

export class ApiProxyStack extends NestedStack {
  constructor(scope: Construct, id: string, props: ApiProxyStackProps, envConfig: SfApiEnvironmentConfiguration) {
    super(scope, id, props);

    // method caching
    const methodOptions: Record<string, MethodDeploymentOptions> = {};
    for (const [key, ttl] of props.cachedMethods) {
      if (ttl === COMPRESSION_ONLY_TTL) {
        // not using it in api gateway
        continue;
      }
      methodOptions[key + '/GET'] = {
        cachingEnabled: true,
        // The maximum TTL value for API Gateway caching is 3600 seconds
        cacheTtl: ttl > MAX_TTL ? Duration.seconds(MAX_TTL) : Duration.seconds(ttl),
      };
    }

    methodOptions['/leads/POST'] = {
      throttlingRateLimit: 50,
      throttlingBurstLimit: 100,
    };

    const deployOptions: StageOptions = {
      loggingLevel: MethodLoggingLevel.INFO,
      metricsEnabled: props.metricsEnabled,
      dataTraceEnabled: props.dataTraceEnabled,
      stageName: props.stackConfig.environmentName,
      cachingEnabled: true,
      cacheClusterSize: props.apiGwCacheSize,
      // disable cache, unless overriden on method level
      cacheTtl: Duration.seconds(0),
      methodOptions: methodOptions,
    };

    const userPool = cognito.UserPool.fromUserPoolId(this, 'userpool', props.userPoolId);

    // proxy lambda
    const projectPath = path.join(PROJECT_ROOT_PATH, 'api-proxy');
    const layerPath = path.resolve(projectPath, 'dist/layer');
    const codePath = path.resolve(projectPath, 'dist/code');

    const modulesLayer = new lambda.LayerVersion(this, 'proxy_node_modules_layer', {
      code: Code.fromAsset(layerPath),
      compatibleRuntimes: [Runtime.NODEJS_18_X],
    });
    const code = Code.fromAsset(codePath);
    const proxy = new lambda.Function(this, 'proxy', {
      functionName: generateStackResourceName(props.stackConfig, 'proxy'),
      runtime: Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      layers: [modulesLayer],
      code: code,
      timeout: Duration.seconds(30),
      memorySize: 1024,
      environment: {
        ENV: props.stackConfig.environmentName,
        READONLY_GROUP_NAMES: props.readonlyGroupNames.join(','),
        FULLACCESS_GROUP_NAMES: props.fullAccessGroupNames.join(','),
        S3_BUCKET_RESUMES: props.stackConfig.generateName('resumes'),
        S3_BUCKET_BFQ: props.bfqBucket,
        KONTENT_SECRET_NAME: props.kontentSecretName,
        LINKEDIN_SECRET_NAME: props.linkedInSecretName,
        OPENAI_SECRET_NAME: props.openaiSecretName,
        ZENDESK_SECRET_NAME: props.zendeskSecretName,
        SF_BASE_URL: props.salesforceBaseUrl,
        USER_POOL_ID: props.userPoolId,
        S3_BUCKET_XO_HIRE_UPLOADS: props.xoHireUploadsS3Bucket,
        JOB_RECOMMENDER_BASE_URL: props.jobRecommenderBaseUrl,
        AI_DATA_TABLE_NAME: props.aiDataTable.tableName,
        SOURCING_INTERNAL_BUCKET: envConfig.sourcing.internalBucketName,
        SOURCING_GENERATOR_LAMBDA_NAME: envConfig.sourcing.jobAdVariationGeneratorLambdaName,
        RECAPTCHA_SECRET_NAME: recaptchaSecretName(),
      },
    });

    userPool.grant(
      proxy,
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:ListUsers',
    );

    props.aiDataTable.grantReadWriteData(proxy);
    proxy.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [
          util.build({
            service: 'ssm',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `parameter/${ProjectName}/${props.stackConfig.environmentName}/*`,
          }),
        ],
        actions: ['*'],
      }),
    );

    proxy.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [
          util.build({
            service: 'secretsmanager',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `secret:${props.kontentSecretName}-??????`,
          }),
          util.build({
            service: 'secretsmanager',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `secret:${props.linkedInSecretName}-??????`,
          }),
          util.build({
            accountId: AWSAccount,
            region: AWSRegion,
            service: 'secretsmanager',
            resource: `secret:${props.openaiSecretName}-??????`,
          }),
          util.build({
            accountId: AWSAccount,
            region: AWSRegion,
            service: 'secretsmanager',
            resource: `secret:${props.zendeskSecretName}-??????`,
          }),
        ],
        actions: ['secretsmanager:GetSecretValue'],
      }),
    );
    proxy.addToRolePolicy(secretAccess(recaptchaSecretName()));

    proxy.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:ListBucket',
          's3:ListBucketVersions',
          's3:GetBucketLocation',
          's3:Get*',
          's3:Put*',
          's3:DeleteObject',
        ],
        resources: [
          'arn:aws:s3:::*-resumes',
          'arn:aws:s3:::*-resumes/*',
          `arn:aws:s3:::${envConfig.sourcing.internalBucketName}`,
          `arn:aws:s3:::${envConfig.sourcing.internalBucketName}/*`,
        ],
      }),
    );
    proxy.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:DeleteObject'],
        resources: [`arn:aws:s3:::${props.xoHireUploadsS3Bucket}`, `arn:aws:s3:::${props.xoHireUploadsS3Bucket}/*`],
      }),
    );
    proxy.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          util.build({
            service: 'lambda',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `function:${envConfig.sourcing.jobAdVariationGeneratorLambdaName}`,
          }),
        ],
      }),
    );
    proxy.addToRolePolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['bedrock:InvokeModel'],
      }),
    );

    // Add permissions to access AWS Secrets Manager
    proxy.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          util.build({
            service: 'secretsmanager',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: 'secret:*',
          }),
        ],
      }),
    );

    const api = new RestApi(this, 'apigw', {
      restApiName: generateStackResourceName(props.stackConfig, 'apigw'),
      deployOptions,
      endpointTypes: [EndpointType.REGIONAL],
      defaultIntegration: new LambdaIntegrationNoPermission(proxy),
      minimumCompressionSize: 16 * 1024, // 16 KB
      binaryMediaTypes: ['*/*'],
    });

    const authorizer = new CognitoUserPoolsAuthorizer(this, 'cognitoAuthorizer', {
      cognitoUserPools: [userPool],
    });

    this.defineApiResources(api, props, proxy, authorizer);

    // this is required, because we are removing automatic permissions
    // see LambdaIntegrationNoPermission class for details
    proxy.addPermission('proxypermission', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      scope: this,
      sourceArn: api.arnForExecuteApi(),
    });

    // logging bucket
    const logBucket = new s3.Bucket(this, generateStackResourceName(props.stackConfig, 'logs'), {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
    });

    // WAF
    const webAcl = new wafv2.CfnWebACL(this, 'webacl', {
      defaultAction: {
        allow: {},
      },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: generateStackResourceName(props.stackConfig, 'webaclmetric'),
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'apply',
          priority: 0,
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              limit: 100,
              scopeDownStatement: {
                andStatement: {
                  statements: [
                    {
                      regexMatchStatement: {
                        fieldToMatch: {
                          uriPath: {},
                        },
                        regexString: '^/apply',
                        textTransformations: [
                          { priority: 0, type: 'REMOVE_NULLS' },
                          { priority: 1, type: 'LOWERCASE' },
                          { priority: 2, type: 'NORMALIZE_PATH' },
                        ],
                      },
                    },
                    {
                      regexMatchStatement: {
                        fieldToMatch: {
                          method: {},
                        },
                        regexString: '^post$',
                        textTransformations: [
                          { priority: 0, type: 'REMOVE_NULLS' },
                          { priority: 1, type: 'LOWERCASE' },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            sampledRequestsEnabled: true,
            metricName: generateStackResourceName(props.stackConfig, 'webaclmetric-rule-apply'),
          },
          action: {
            block: {},
          },
        },
      ],
    });

    // cloudfront
    const apiEndPointUrlWithoutProtocol = cdk.Fn.select(1, cdk.Fn.split('://', api.urlForPath()));
    const apiEndPointDomainName = cdk.Fn.select(0, cdk.Fn.split('/', apiEndPointUrlWithoutProtocol));
    const distribution = this.createDistribution(
      props,
      apiEndPointDomainName,
      `/${api.deploymentStage.stageName}`,
      logBucket,
      webAcl,
    );

    // DNS
    if (props.dns) {
      defineDNSRecords(this, props.dns, distribution);
    }

    const bfqBucket = s3.Bucket.fromBucketName(this, 'bfq', props.bfqBucket);

    proxy.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [bfqBucket.bucketArn, bfqBucket.arnForObjects('*')],
        actions: ['s3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject', 's3:DeleteObject'],
      }),
    );

    // Veriff media
    const veriffMedia = this.defineVeriffMediaQueue(props, modulesLayer, code);
    proxy.addEnvironment('VERIFF_MEDIA_QUEUE_URL', veriffMedia.veriffMediaQueue.queueUrl);
    proxy.addEnvironment('VERIFF_MEDIA_BUCKET', veriffMedia.veriffMediaBucket.bucketName);
    veriffMedia.veriffMediaBucket.grantReadWrite(proxy);
    veriffMedia.veriffMediaQueue.grantSendMessages(proxy);
  }

  private createDistribution(
    props: ApiProxyStackProps,
    apiDomain: string,
    apiPath: string,
    logBucket: s3.IBucket,
    webAcl: CfnWebACL,
  ): cloudfront.Distribution {
    const origin: IOrigin = new origins.HttpOrigin(apiDomain, {
      originPath: apiPath,
    });

    const originRequestPolicy = cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(
      this,
      'ORP-No-Headers',
      ORP_NO_HEADERS_ID,
    );

    const forwardXAuthAndXHmacRequestPolicy = cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(
      this,
      'forward-x-auth-And-x-hmac-header',
      FORWARD_X_AUTH_AND_X_HMAC_HEADER_ID,
    );

    const forwardAll = cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(this, 'forward-all', FORWARD_ALL);

    const requestPolicyList: [string, cdk.aws_cloudfront.IOriginRequestPolicy][] = [
      [ORP_NO_HEADERS_ID, originRequestPolicy],
      [FORWARD_X_AUTH_AND_X_HMAC_HEADER_ID, forwardXAuthAndXHmacRequestPolicy],
      [FORWARD_ALL, forwardAll],
    ];

    const additionalBehaviors: Record<string, BehaviorOptions> = {};
    const cachePolicies: ICachePolicy[] = [];

    for (const [key, ttl] of props.cachedMethods) {
      // adopt api-gw paths to cloudfront paths
      const path = key.replace(/{[^}]+}/g, '*');
      const cachePolicyIdTuple = CachePolicyIdsByTtl.find((r) => r[0] === ttl);
      if (!cachePolicyIdTuple) {
        throw new Error(`Cache policy not found for the specified TTL ${ttl}`);
      }
      const cachePolicyId = cachePolicyIdTuple[1];
      let cachePolicy = cachePolicies.find((p) => p.cachePolicyId === cachePolicyId);
      if (!cachePolicy) {
        cachePolicies.push((cachePolicy = CachePolicy.fromCachePolicyId(this, `cache-policy-${ttl}`, cachePolicyId)));
      }

      const requestPolicyIdRecord = props.methodsPolicy.find((policy) => policy[0] === key);
      let requestPolicyIdTuple = null;
      if (requestPolicyIdRecord != null) {
        requestPolicyIdTuple = requestPolicyList.find((policy) => policy[0] === requestPolicyIdRecord[1]);
      }

      let requestPolicy = null;
      if (requestPolicyIdTuple == null) {
        requestPolicy = originRequestPolicy;
      } else {
        requestPolicy = requestPolicyIdTuple[1];
      }

      additionalBehaviors[path] = {
        origin: origin,
        cachePolicy: cachePolicy,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        originRequestPolicy: requestPolicy,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
      };
    }

    return new cloudfront.Distribution(this, 'distribution', {
      defaultBehavior: {
        origin: origin,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        originRequestPolicy: originRequestPolicy,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: additionalBehaviors,
      logBucket: logBucket,
      priceClass: PriceClass.PRICE_CLASS_ALL,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2018,
      ...getDistributionDnsProps(this, props.dns),
      webAclId: webAcl.attrArn,
    });
  }

  private defineApiResources(
    api: RestApi,
    props: ApiProxyStackProps,
    proxy: lambda.IFunction,
    authorizer: CognitoUserPoolsAuthorizer,
  ) {
    const root = api.root;
    const acIntegration = new LambdaIntegration(props.actionCaller);

    // vendor callbacks
    this.addEndpoint(root, 'POST', 'assessments/callback/{apiSecret}/{vendor}', acIntegration);
    this.addEndpoint(root, 'PUT', 'assessments/callback/{apiSecret}/{vendor}', acIntegration);
    this.addEndpoint(root, 'POST', 'assessments/callback/{apiSecret}/{vendor}/{asrId}', acIntegration);
    this.addEndpoint(root, 'PUT', 'assessments/callback/{apiSecret}/{vendor}/{asrId}', acIntegration);
    this.addEndpoint(root, 'POST', 'assessments/proctoring-callback/{apiSecret}/{vendor}', acIntegration);
    this.addEndpoint(root, 'PUT', 'assessments/proctoring-callback/{apiSecret}/{vendor}', acIntegration);
    this.addEndpoint(root, 'POST', 'assessments/proctoring-callback/{apiSecret}/{vendor}/{asrId}', acIntegration);
    this.addEndpoint(root, 'PUT', 'assessments/proctoring-callback/{apiSecret}/{vendor}/{asrId}', acIntegration);

    // "PASSTHROUGH" endpoints
    this.addEndpoint(root, 'POST', 'auth', new LambdaIntegration(props.authLambda));
    this.addEndpoint(root, 'GET', 'maintenance-metadata');
    this.addEndpoint(
      root,
      'GET',
      'record-types/{object-name}',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.object-name'],
      }),
      {
        requestParameters: {
          'method.request.path.object-name': true,
        },
      },
    );
    this.addEndpoint(
      root,
      'GET',
      'support-contact/{id}',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.id'],
      }),
      {
        requestParameters: {
          'method.request.path.id': true,
        },
      },
    );
    this.addEndpoint(
      root,
      'GET',
      'jobBoardCell/{id}',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.id'],
      }),
      {
        requestParameters: {
          'method.request.path.id': true,
        },
      },
    );
    this.addEndpoint(
      root,
      'GET',
      'pipelines',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: [
          'method.request.querystring.product-code',
          'method.request.querystring.stakeholderId',
          'method.request.querystring.status',
        ],
      }),
      {
        requestParameters: {
          'method.request.querystring.product-code': false,
          'method.request.querystring.stakeholderId': false,
          'method.request.querystring.status': false,
        },
      },
    );
    this.addEndpoint(
      root,
      'GET',
      'pipelines/{id}',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.id'],
      }),
      {
        requestParameters: {
          'method.request.path.id': true,
        },
      },
    );
    this.addEndpoint(
      root,
      'GET',
      'roles/{id}',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.id'],
      }),
      {
        requestParameters: {
          'method.request.path.id': true,
        },
      },
    );
    this.addEndpoint(root, 'GET', 'ui-strings');
    this.addEndpoint(
      root,
      'GET',
      'picklist-values/{object}/{field}',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.object', 'method.request.path.field'],
      }),
      {
        requestParameters: {
          'method.request.path.object': true,
          'method.request.path.field': true,
        },
      },
    );
    this.addEndpoint(
      root,
      'GET',
      'user-image/{id}',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.id'],
      }),
      {
        requestParameters: {
          'method.request.path.id': true,
        },
      },
    );
    this.addEndpoint(
      root,
      'GET',
      'googlejobs/getJobPostingSchema',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.querystring.jobId', 'method.request.querystring.jobIdType'],
      }),
      {
        requestParameters: {
          'method.request.querystring.jobId': true,
          'method.request.querystring.jobIdType': true,
        },
      },
    );
    this.addEndpoint(root, 'GET', 'email-settings');
    this.addEndpoint(root, 'POST', 'email-settings');
    this.addEndpoint(
      root,
      'GET',
      'googlejobs/topCellsInCity',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: [
          'method.request.querystring.city',
          'method.request.querystring.country',
          'method.request.querystring.pipelines',
        ],
      }),
      {
        requestParameters: {
          'method.request.querystring.city': true,
          'method.request.querystring.country': true,
          'method.request.querystring.pipelines': true,
        },
      },
    );
    this.addEndpoint(
      root,
      'GET',
      'googlejobs/topCities/{country}',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.country'],
      }),
      {
        requestParameters: {
          'method.request.path.country': true,
        },
      },
    );
    this.addEndpoint(root, 'GET', 'googlejobs/topCountries');
    this.addEndpoint(
      root,
      'GET',
      'googlejobs/topTitles',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.querystring.pipelines'],
      }),
      {
        requestParameters: {
          'method.request.querystring.pipelines': true,
        },
      },
    );
    this.addEndpoint(root, 'POST', 'indeed-apply');
    this.addEndpoint(root, 'POST', 'webhook/veriff/event');
    this.addEndpoint(root, 'POST', 'webhook/veriff/decision');
    this.addEndpoint(
      root,
      'GET',
      'job-ads/export-xml',
      new LambdaIntegration(props.jobSlotXMLPublishingLambda, {
        proxy: false,
        integrationResponses: [{ statusCode: '200' }],
      }),
      // required for this integration
      { methodResponses: [{ statusCode: '200', responseModels: { 'application/json': Model.EMPTY_MODEL } }] },
    );
    this.addEndpoint(
      root,
      'GET',
      'require-finalize-sign-up/{email}',
      new LambdaIntegration(props.requireFinalizeSignUpLambda),
    );
    this.addEndpoint(root, 'POST', 'apply');
    this.addEndpoint(root, 'GET', 'assessments', undefined, {
      requestParameters: {
        'method.request.querystring.categoryId': false,
        'method.request.querystring.domain': false,
        'method.request.querystring.pipelineIds': false,
        'method.request.querystring.type': false,
      },
    });
    this.addEndpoint(
      root,
      'GET',
      'proctoredAssessment/{asrId}',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.asrId'],
      }),
      {
        requestParameters: {
          'method.request.path.asrId': true,
        },
      },
    );
    this.addEndpoint(root, 'POST', 'leads');

    this.addEndpoint(root, 'GET', 'testimonials/allContinents');

    this.addEndpoint(
      root,
      'GET',
      'testimonials/byCountry',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.querystring.country'],
      }),
      {
        requestParameters: {
          'method.request.querystring.country': true,
        },
      },
    );
    this.addEndpoint(
      root,
      'GET',
      'testimonials/byCountryAndDomain',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.querystring.country', 'method.request.querystring.domain'],
      }),
      {
        requestParameters: {
          'method.request.querystring.country': true,
          'method.request.querystring.domain': true,
        },
      },
    );

    this.addEndpoint(
      root,
      'GET',
      'testimonials/byContinent',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.querystring.continent'],
      }),
      {
        requestParameters: {
          'method.request.querystring.continent': true,
        },
      },
    );

    this.addEndpoint(
      root,
      'GET',
      'testimonials/countryContinent',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.querystring.country'],
      }),
      {
        requestParameters: {
          'method.request.querystring.country': true,
        },
      },
    );
    this.addEndpoint(root, 'POST', '{secretKey}/delete-candidate-data', new LambdaIntegrationNoPermission(proxy), {
      requestParameters: {
        'method.request.path.secretKey': true,
      },
    });
    this.addEndpoint(root, 'POST', 'cmsupdate/faqhelpfulness');
    this.addEndpoint(root, 'POST', 'cmsupdate/pipelineMetadata');
    this.addEndpoint(root, 'POST', 'check-email', new LambdaIntegrationNoPermission(proxy));
    this.addEndpoint(root, 'POST', 'verify-hash-id', new LambdaIntegrationNoPermission(proxy));

    this.addEndpoint(
      root,
      'GET',
      'sso/{provider}/userinfo',
      new LambdaIntegrationNoPermission(proxy, {
        cacheKeyParameters: ['method.request.path.provider'],
      }),
      {
        requestParameters: {
          'method.request.path.provider': true,
        },
      },
    );

    // "AUTHORIZE" endpoints

    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/apply', authorizer);
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/contacts', authorizer);
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/assessment-results/{asrId}/responses', authorizer);
    this.addPrivateEndpoint(
      root,
      'GET',
      'candidates/{id}',
      authorizer,
      new LambdaIntegration(proxy, {
        cacheKeyParameters: ['method.request.querystring.xoManageId', 'method.request.path.id'],
      }),
      {
        requestParameters: {
          'method.request.querystring.xoManageId': false,
          'method.request.path.id': true,
        },
      },
    );
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/assessment-results', authorizer);
    this.addPrivateEndpoint(
      root,
      'GET',
      'candidates/{id}/info',
      authorizer,
      new LambdaIntegration(proxy, {
        cacheKeyParameters: ['method.request.path.id'],
      }),
      {
        requestParameters: {
          'method.request.path.id': true,
        },
      },
    );
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/applications', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/cases', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/info', authorizer);
    this.addPrivateEndpoint(root, 'DELETE', 'candidates/{id}/info/{infoid}', authorizer);
    this.addPrivateEndpoint(root, 'PATCH', 'candidates/{id}/info/{infoid}', authorizer);
    this.addPrivateEndpoint(root, 'PATCH', 'candidates/{id}/location', authorizer);
    this.addPrivateEndpoint(root, 'PATCH', 'candidates/{id}', authorizer);
    this.addPrivateEndpoint(
      root,
      'GET',
      'candidates/{id}/applications/{appId}/earnable-badges',
      authorizer,
      new LambdaIntegration(proxy, {
        cacheKeyParameters: ['method.request.path.appId'],
      }),
      {
        requestParameters: {
          'method.request.path.appId': true,
        },
      },
    );
    this.addPrivateEndpoint(
      root,
      'GET',
      'candidates/{id}/pipelines/{pipelineId}/earnable-badges',
      authorizer,
      new LambdaIntegration(proxy, {
        cacheKeyParameters: ['method.request.path.id', 'method.request.path.pipelineId'],
      }),
      {
        requestParameters: {
          'method.request.path.id': true,
          'method.request.path.pipelineId': true,
        },
      },
    );
    this.addPrivateEndpoint(root, 'PATCH', 'candidates/{id}/assessment-results/{asrId}', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/assessment-results/{asrId}/complete', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/assessment-results/{asrId}/get-url', authorizer);
    this.addPrivateEndpoint(root, 'PATCH', 'candidates/{id}/assessment-results/{asrId}/skip-interview', authorizer);
    this.addPrivateEndpoint(
      root,
      'GET',
      'candidates/{id}/assessment-results/{asrId}/dependent-applications',
      authorizer,
    );
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/assessment-results/{asrId}/cancel', authorizer);
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/assessments', authorizer, undefined, {
      requestParameters: {
        'method.request.querystring.categoryId': false,
        'method.request.querystring.domain': false,
        'method.request.querystring.pipelineIds': false,
        'method.request.querystring.type': false,
      },
    });
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/identity-proof', authorizer);
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/identity-proof/latest', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/privacy-policy-accept', authorizer);
    this.addPrivateEndpoint(
      root,
      'POST',
      'candidates/{id}/avatar',
      authorizer,
      new LambdaIntegration(props.uploadAvatarLambda),
    );
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/download-resume', authorizer);
    this.addPrivateEndpoint(root, 'HEAD', 'candidates/{id}/download-resume', authorizer);
    this.addPrivateEndpoint(
      root,
      'GET',
      'candidates/{id}/next-step',
      authorizer,
      new LambdaIntegration(proxy, {
        cacheKeyParameters: ['method.request.path.id'],
      }),
      {
        requestParameters: {
          'method.request.path.id': true,
        },
      },
    );
    this.addPrivateEndpoint(
      root,
      'GET',
      'candidates/{id}/recommended-jobs',
      authorizer,
      new LambdaIntegration(proxy, {
        cacheKeyParameters: ['method.request.path.id'],
      }),
      {
        requestParameters: {
          'method.request.path.id': true,
        },
      },
    );
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/recommended-jobs/interactions', authorizer);
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/resume', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/resume', authorizer);
    this.addPrivateEndpoint(root, 'PATCH', 'candidates/{id}/applications/{appId}', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/applications/{appId}/apply-email', authorizer);
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/applications/{appId}/apply-email', authorizer);

    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/earned-badges', authorizer, undefined, {
      requestParameters: {
        'method.request.querystring.jobId': false,
      },
    });
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/executive-summary/{pipelineId}', authorizer);
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/spotlight/{pipelineId}', authorizer);
    this.addPrivateEndpoint(root, 'GET', 'sourcing/job-ad-title-variation/{titleIds}', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'sourcing/generate-job-ads-variations', authorizer);

    // BFQs
    this.addEndpoint(root, 'GET', 'standard-bfqs');
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/standard-bfq-answers', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/standard-bfq-answers', authorizer);
    this.addPrivateEndpoint(root, 'GET', 'candidates/{id}/standard-bfq-answers/job-role', authorizer);
    this.addPrivateEndpoint(root, 'POST', 'candidates/{id}/standard-bfq-answers/job-role', authorizer);

    // Tracking
    this.addEndpoint(root, 'GET', 'tracking');
  }

  private addPrivateEndpoint(
    root: IResource,
    method: string,
    path: string,
    authorizer: CognitoUserPoolsAuthorizer,
    target?: Integration,
    options?: MethodOptions,
  ) {
    this.getOrAddResource(root, path).addMethod(method, target, {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
      authorizationScopes: ['aws.cognito.signin.user.admin'],
      ...options,
    });
  }

  private addEndpoint(root: IResource, method: string, path: string, target?: Integration, options?: MethodOptions) {
    this.getOrAddResource(root, path).addMethod(method, target, options);
  }

  private getOrAddResource(root: IResource, path: string) {
    let current = root;
    this.addMockOptionsMethod(current);

    for (const part of path.split('/')) {
      current = current.getResource(part) ?? current.addResource(part);
      this.addMockOptionsMethod(current);
    }

    return current;
  }

  private addMockOptionsMethod(resource: IResource) {
    if (!(resource.node.tryFindChild('OPTIONS') instanceof Method)) {
      resource.addMethod(
        'OPTIONS',
        new MockIntegration({
          integrationResponses: [
            {
              statusCode: '204',
              contentHandling: ContentHandling.CONVERT_TO_TEXT,
              responseTemplates: {
                'application/json': '',
              },
              responseParameters: {
                'method.response.header.Access-Control-Allow-Headers':
                  "'Content-Type,Content-Disposition,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,Accept-Encoding,Accept,Content-Encoding,X-Auth-Client,X-Hmac-Signature,X-Session-ID'",
                'method.response.header.Access-Control-Allow-Origin': "'*'",
                'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
              },
            },
          ],
          contentHandling: ContentHandling.CONVERT_TO_TEXT,
          requestTemplates: {
            'application/json': '{"statusCode": 204}',
          },
        }),
        {
          methodResponses: [
            {
              statusCode: '204',
              responseParameters: {
                'method.response.header.Access-Control-Allow-Headers': true,
                'method.response.header.Access-Control-Allow-Methods': true,
                'method.response.header.Access-Control-Allow-Origin': true,
              },
            },
          ],
        },
      );
    }
  }

  private defineVeriffMediaQueue(props: ApiProxyStackProps, layer: lambda.LayerVersion, code: lambda.AssetCode) {
    const veriffMediaQueue = new Queue(this, 'veriff-media-queue', {
      queueName: props.stackConfig.generateName('veriff-media'),
      visibilityTimeout: Duration.minutes(15),
    });
    const veriffMediaBucket = new Bucket(this, 'veriff-media-bucket', {
      bucketName: props.stackConfig.generateName('veriff-media'),
      removalPolicy: props.isPreview ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: props.isPreview,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
      versioned: true,
    });
    const veriffMediaQueueHandler = new lambda.Function(this, 'veriff-media-handler', {
      functionName: props.stackConfig.generateName('veriff-media-handler'),
      runtime: Runtime.NODEJS_18_X,
      handler: 'veriff-media/queue-handler.handler',
      layers: [layer],
      code: code,
      timeout: Duration.minutes(10),
      memorySize: 1024,
      environment: {
        ENV: props.stackConfig.environmentName,
        VERIFF_MEDIA_BUCKET: veriffMediaBucket.bucketName,
      },
    });
    veriffMediaQueueHandler.addToRolePolicy(ssmPolicy(props.stackConfig.environmentName));
    veriffMediaBucket.grantReadWrite(veriffMediaQueueHandler);

    veriffMediaQueueHandler.addEventSource(
      new SqsEventSource(veriffMediaQueue, {
        maxConcurrency: 2,
      }),
    );

    return {
      veriffMediaQueue,
      veriffMediaBucket,
      veriffMediaQueueHandler,
    };
  }
}

/**
 * TODO:
 * Removes all auto-generated lambda permissions, because they cause
 * "The final policy size (20764) is bigger than the limit (20480)" error
 * for a large amount of endpoints.
 * See https://github.com/aws/aws-cdk/issues/9327
 */
class LambdaIntegrationNoPermission extends LambdaIntegration {
  constructor(handler: lambda.IFunction, options?: LambdaIntegrationOptions) {
    super(handler, options);
  }

  bind(method: Method): IntegrationConfig {
    const integrationConfig = super.bind(method);
    const permissions = method.node.children.filter(
      // @ts-ignore
      (c) => c.node.host.action === 'lambda:InvokeFunction',
    );
    permissions.forEach((p) => method.node.tryRemoveChild(p.node.id));
    return integrationConfig;
  }
}
