import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { OriginSslPolicy, PriceClass } from 'aws-cdk-lib/aws-cloudfront';
import { defineDNSRecords, getDistributionDnsProps } from '../../utils/dns-helpers';
import { KontentApiConfig, project } from './kontent-api-config';
import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { AWSAccount, AWSRegion, generateStackResourceName, getSsmValue } from '../../config/environments';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

@Deployment(project.name, project.name)
export class KontentApiStack extends RootStack {
  constructor(stackConfig: StackConfig, config: KontentApiConfig) {
    stackConfig.props = {
      env: {
        account: AWSAccount,
        region: AWSRegion,
      },
    };
    super(stackConfig);

    // cloudfront
    const origin = new origins.HttpOrigin('deliver.kontent.ai', {
      originPath: `/${getSsmValue(this, `${project.name}/projectId`)}`,
      originSslProtocols: [OriginSslPolicy.TLS_V1],
    });

    const cachePolicy = cloudfront.CachePolicy.fromCachePolicyId(
      this,
      'cachePolicy',
      getSsmValue(this, `${project.name}/cachePolicyId`),
    );

    // Cache policy with increased TTL for .webm files
    const webmCachePolicy = new cloudfront.CachePolicy(this, 'kontent-webm-ttl', {
      cachePolicyName: this.generateName('kontent-webm-ttl-v2'),
      comment: 'Cache policy with increased TTL for .webm files',
      defaultTtl: Duration.hours(48), // TTL for 48 hours
      minTtl: Duration.hours(48),
      maxTtl: Duration.hours(48),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      enableAcceptEncodingGzip: true,
    });

    // logging bucket
    const logBucket = new s3.Bucket(this, 'logs', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      bucketName: generateStackResourceName(stackConfig, 'logs'),
    });

    const originRequestPolicy = cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(
      this,
      'originRequestPolicy',
      getSsmValue(this, `${project.name}/originRequestPolicyId`),
    );

    const distribution = new cloudfront.Distribution(this, this.generateName('distribution'), {
      defaultBehavior: {
        origin: origin,
        cachePolicy: cachePolicy,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        originRequestPolicy: originRequestPolicy,
      },
      additionalBehaviors: {
        '*.webm': {
          origin: origin,
          cachePolicy: webmCachePolicy,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: originRequestPolicy,
        },
      },
      logBucket: logBucket,
      priceClass: PriceClass.PRICE_CLASS_ALL,
      ...getDistributionDnsProps(this, config.dns),
    });

    defineDNSRecords(this, config.dns, distribution);
  }
}
