import { AfterDeployment, Configurator, InfraCallback } from '@trilogy-group/lambda-cdk-infra';
import { BeforeDestruction, Configuration, Infra } from '@trilogy-group/lambda-cdk-infra';
import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';
import {
  DefaultDnsConfig,
  FORWARD_ALL,
  FORWARD_X_AUTH_AND_X_HMAC_HEADER_ID,
  ORP_NO_HEADERS_ID,
  PreviewEnvName,
  ProductionEnvName,
  ProjectName,
  SandEnvName,
} from '../../config/environments';
import { DnsConfig } from '../../config/model';
import { Projects } from '../../config/projects';
import { syncCognitoUsers } from '../../utils/cognito-seed-user';

export const project = Projects['sf-api'];

// only for cloudfront compression
export const COMPRESSION_ONLY_TTL = 1;
export const SMALL_TTL = 300;
export const MAX_TTL = 3600;
export const ONE_DAY_TTL = 86400;
export const DISABLED_TTL = 0;

export const CachePolicyIdsByTtl: [number, string][] = [
  [COMPRESSION_ONLY_TTL, '993c8190-03b9-4ed5-8c06-25858ffd31c0'],
  [SMALL_TTL, '4a71331d-6a0a-4594-9558-088acfe131e8'],
  [MAX_TTL, 'f7e08c45-3f97-442d-b738-f6f4bc587f35'],
  [ONE_DAY_TTL, 'fa379888-4db0-4e31-ad67-e20773868b0e'],
  [DISABLED_TTL, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'],
];

const sfApiCachedMethods: [string, number][] = [
  ['/candidates/{id}/contacts', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/assessment-results/{asrId}/responses', COMPRESSION_ONLY_TTL],
  ['/assessments', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/assessment-results', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/download-resume', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/resume', COMPRESSION_ONLY_TTL],
  ['/job-ads/export-xml', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/applications', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/applications/{appId}/earnable-badges', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/pipelines/{pipelineId}/earnable-badges', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/info', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/recommended-jobs', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/spotlight/{pipelineId}', COMPRESSION_ONLY_TTL],
  ['/candidates/{id}/next-step', COMPRESSION_ONLY_TTL],

  ['/maintenance-metadata', SMALL_TTL],
  ['/pipelines', MAX_TTL],
  ['/support-contact/{id}', MAX_TTL],
  ['/ui-strings', MAX_TTL],
  ['/record-types/{object-name}', MAX_TTL],
  ['/roles/{id}', MAX_TTL],
  ['/pipelines/{id}', MAX_TTL],
  ['/user-image/{id}', MAX_TTL],
  ['/jobBoardCell/{id}', MAX_TTL],
  ['/googlejobs/topCellsInCity', ONE_DAY_TTL],
  ['/googlejobs/getJobPostingSchema', ONE_DAY_TTL],
  ['/googlejobs/topCities/{country}', ONE_DAY_TTL],
  ['/{secretKey}/delete-candidate-data', ONE_DAY_TTL],

  ['/indeed-apply', COMPRESSION_ONLY_TTL],

  ['/webhook/veriff/decision', DISABLED_TTL],
  ['/webhook/veriff/event', DISABLED_TTL],

  ['/testimonials/allContinents', ONE_DAY_TTL],
  ['/testimonials/byCountry', ONE_DAY_TTL],
  ['/testimonials/byCountryAndDomain', ONE_DAY_TTL],
  ['/testimonials/byContinent', ONE_DAY_TTL],
  ['/testimonials/countryContinent', ONE_DAY_TTL],

  ['/sourcing/generate-job-ads-variations', DISABLED_TTL],
  ['/sourcing/job-ad-title-variation/{titleIds}', DISABLED_TTL],

  ['/cmsupdate/faqhelpfulness', DISABLED_TTL],
  ['/cmsupdate/pipelineMetadata', DISABLED_TTL],
  ['/check-email', DISABLED_TTL],
  ['/verify-hash-id', DISABLED_TTL],
  ['/sso/{provider}/userinfo', DISABLED_TTL],
];

// FIXME: Remove all items with ORP_NO_HEADERS_ID and make it default behaviour.
const sfApiMethodsPolicy: [string, string][] = [
  ['/candidates/{id}/contacts', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/assessment-results/{id}/responses', ORP_NO_HEADERS_ID],
  ['/assessments', ORP_NO_HEADERS_ID],
  ['/candidates/{id}', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/assessment-results', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/download-resume', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/resume', ORP_NO_HEADERS_ID],
  ['/job-ads/export-xml', ORP_NO_HEADERS_ID],
  ['/maintenance-metadata', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/applications', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/applications/{appId}/earnable-badges', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/pipelines/{pipelineId}/earnable-badges', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/info', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/recommended-jobs', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/recommended-jobs/interactions', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/spotlight/{pipelineId}', ORP_NO_HEADERS_ID],
  ['/candidates/{id}/next-step', ORP_NO_HEADERS_ID],
  ['/picklist-values/{object}/{field}', ORP_NO_HEADERS_ID],
  ['/pipelines', ORP_NO_HEADERS_ID],
  ['/support-contact/{id}', ORP_NO_HEADERS_ID],
  ['/ui-strings', ORP_NO_HEADERS_ID],
  ['/record-types/{object-name}', ORP_NO_HEADERS_ID],
  ['/roles/{id}', ORP_NO_HEADERS_ID],
  ['/pipelines/{id}', ORP_NO_HEADERS_ID],
  ['/user-image/{id}', ORP_NO_HEADERS_ID],
  ['/jobBoardCell/{id}', ORP_NO_HEADERS_ID],
  ['/googlejobs/topCellsInCity', ORP_NO_HEADERS_ID],
  ['/googlejobs/getJobPostingSchema', ORP_NO_HEADERS_ID],
  ['/googlejobs/topCities/{country}', ORP_NO_HEADERS_ID],
  ['/webhook/veriff/decision', FORWARD_X_AUTH_AND_X_HMAC_HEADER_ID],
  ['/webhook/veriff/event', FORWARD_X_AUTH_AND_X_HMAC_HEADER_ID],
  ['/{secretKey}/delete-candidate-data', ORP_NO_HEADERS_ID],
  ['/indeed-apply', FORWARD_ALL],

  ['/testimonials/allContinents', ORP_NO_HEADERS_ID],
  ['/testimonials/byCountry', ORP_NO_HEADERS_ID],
  ['/testimonials/byCountryAndDomain', ORP_NO_HEADERS_ID],
  ['/testimonials/byContinent', ORP_NO_HEADERS_ID],
  ['/testimonials/countryContinent', ORP_NO_HEADERS_ID],

  ['/sourcing/job-ad-title-variation/{titleIds}', FORWARD_ALL],
  ['/sourcing/generate-job-ads-variations', FORWARD_ALL],

  ['/cmsupdate/faqhelpfulness', FORWARD_X_AUTH_AND_X_HMAC_HEADER_ID],
  ['/cmsupdate/pipelineMetadata', FORWARD_X_AUTH_AND_X_HMAC_HEADER_ID],
  ['/check-email', ORP_NO_HEADERS_ID],
  ['/verify-hash-id', FORWARD_ALL],
  ['/sso/{provider}/userinfo', FORWARD_ALL],
];
const DefaultActionCallerConfig = {
  getSsmConfigParameter: (envName: string) => [`/xo-hiring/${envName}/sf-api/action-caller`],
  getSsmServiceAccountParameter: (envName: string) => [`/xo-hiring/${envName}/common/salesforce-service-account`],
};

const DefaultAuthConfig = {
  sfApiVersion: '54.0',
};

export interface ApiConfiguration {
  jobSlotXMLPublishingLambdaName: string;
  uploadAvatarLambdaName: string;
  bfqBucket: string;
  dataTraceEnabled?: boolean;
  metricsEnabled?: boolean;
  apiGwCacheSize: '0.5' | '1.6' | '6.1';
  cachedMethods: [string, number][];
  methodsPolicy: [string, string][];
  dns?: DnsConfig;
}

export interface SfApiEnvironmentConfiguration {
  api: ApiConfiguration;
  actionCaller: {
    failureSnsTopic?: string;
    getSsmConfigParameter: (envName: string) => string[];
    getSsmServiceAccountParameter: (envName: string) => string[];
  };
  authConfig: {
    sfUrl: string;
    sfApiVersion: string;
    userPoolId: string;
    clientId: string;
  };
  kontentSecretName: string;
  linkedInSecretName: string;
  openaiSecretName: string;
  zendeskSecretName: string;
  recaptchaSecretName: string;
  salesforceBaseUrl: string;
  xoHireUploadsS3Bucket: string;
  jobRecommenderBaseUrl: string;
  interviewBotTableName: string;
  promptLensSecretName: string;
  interviewBotApiUrl: (env: string) => string;
  sourcing: {
    internalBucketName: string;
    jobAdVariationGeneratorLambdaName: string;
  };
}

@Configuration(project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<SfApiEnvironmentConfiguration> {
  config(): SfApiEnvironmentConfiguration {
    return {
      api: {
        jobSlotXMLPublishingLambdaName: 'xo-salesforce-job-slot-xml-publishing',
        uploadAvatarLambdaName: 'xo-hiring-production-uploadavatar-v2',
        bfqBucket: Infra.generateResourceName('bfq', ProductionEnvName),
        dataTraceEnabled: true,
        metricsEnabled: true,
        apiGwCacheSize: '1.6',
        cachedMethods: sfApiCachedMethods,
        methodsPolicy: sfApiMethodsPolicy,
        dns: {
          ...DefaultDnsConfig,
          cnameRecordName: 'profile-api.crossover.com',
        },
      },
      actionCaller: {
        failureSnsTopic: 'xo-hire-failures',
        ...DefaultActionCallerConfig,
      },
      authConfig: {
        ...DefaultAuthConfig,
        sfUrl: 'https://crossover.my.salesforce.com',
        userPoolId: 'us-east-1_4HInMoHb2',
        clientId: '3s957fmcouf6jahgghlfcdu1e2',
      },
      kontentSecretName: 'xo-hiring-admin-production/kontent-ai',
      linkedInSecretName: 'xo-hiring/integration/production/linkedin',
      openaiSecretName: 'xo-hiring/integration/production/openai',
      zendeskSecretName: 'xo-hiring/integration/production/zendesk-central',
      recaptchaSecretName: 'xo-hiring/integration/production/recaptcha',
      salesforceBaseUrl: 'https://crossover.lightning.force.com',
      xoHireUploadsS3Bucket: 'xo-hire-uploads',
      jobRecommenderBaseUrl: 'https://job-recommender.crossover.com',
      interviewBotTableName: 'xo-hiring-interview-bot-production-main',
      promptLensSecretName: 'xo-hiring/prod/promptlens',
      interviewBotApiUrl: () => `https://assessments-api-rest.crossover.com`,
      sourcing: {
        internalBucketName: 'xo-hiring-production-sourcing-internal-data',
        jobAdVariationGeneratorLambdaName: 'xo-hiring-production-sm-generate-job-ads-title-variations',
      },
    };
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfig implements Configurator<SfApiEnvironmentConfiguration> {
  config(): SfApiEnvironmentConfiguration {
    return {
      api: {
        jobSlotXMLPublishingLambdaName: 'xo-salesforce-job-slot-xml-publishing-sandbox',
        uploadAvatarLambdaName: 'xo-hiring-sandbox-uploadavatar-v2',
        bfqBucket: Infra.generateResourceName('bfq', SandEnvName),
        dataTraceEnabled: true,
        metricsEnabled: false,
        apiGwCacheSize: '0.5',
        cachedMethods: sfApiCachedMethods,
        methodsPolicy: sfApiMethodsPolicy,
        dns: {
          ...DefaultDnsConfig,
          cnameRecordName: 'sandbox-profile-api.crossover.com',
        },
      },
      actionCaller: {
        ...DefaultActionCallerConfig,
      },
      authConfig: {
        ...DefaultAuthConfig,
        sfUrl: 'https://crossover--fullshared.sandbox.my.salesforce.com',
        userPoolId: 'us-east-1_c3Dd1dx3i',
        clientId: '32p59uverui30ve87vnr5pi4f5',
      },
      kontentSecretName: 'xo-hiring-admin-sand/kontent-ai',
      openaiSecretName: 'xo-hiring/integration/sandbox/openai',
      linkedInSecretName: 'xo-hiring/integration/sandbox/linkedin',
      zendeskSecretName: 'xo-hiring/integration/sandbox/zendesk-central',
      recaptchaSecretName: 'xo-hiring/integration/sandbox/recaptcha',
      salesforceBaseUrl: 'https://crossover--fullshared.sandbox.lightning.force.com',
      xoHireUploadsS3Bucket: 'xo-hire-uploads-dev',
      jobRecommenderBaseUrl: 'https://job-recommender-sandbox.crossover.com',
      interviewBotTableName: 'xo-hiring-interview-bot-sandbox-main',
      promptLensSecretName: 'xo-hiring/dev/promptlens',
      interviewBotApiUrl: () => `https://sandbox-assessments-api-rest.crossover.com`,
      sourcing: {
        internalBucketName: 'xo-hiring-sandbox-sourcing-internal-data',
        jobAdVariationGeneratorLambdaName: 'xo-hiring-sandbox-sm-generate-job-ads-title-variations',
      },
    };
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfig extends SandboxConfig {
  config(): SfApiEnvironmentConfiguration {
    const baseConfig = super.config();
    return {
      ...baseConfig,
      api: {
        ...baseConfig.api,
        // don't allocate dns records for previews
        dns: undefined,
      },
      // fallback to base config parameters, if preview parameter is not defined
      actionCaller: {
        getSsmConfigParameter: (envName: string) =>
          [`/xo-hiring/${envName}/sf-api/action-caller`].concat(
            baseConfig.actionCaller.getSsmConfigParameter(SandEnvName),
          ),
        getSsmServiceAccountParameter: (envName: string) =>
          [`/xo-hiring/${envName}/common/salesforce-service-account`].concat(
            baseConfig.actionCaller.getSsmServiceAccountParameter(SandEnvName),
          ),
      },
    };
  }
}

@BeforeDestruction(project.name)
export class BeforeDestructionLogic implements InfraCallback<SfApiEnvironmentConfiguration> {
  async invoke(env: string): Promise<void> {
    console.log(`Dropping all SSM parameters for env: ${env}`);
    const prEnv = new SsmEditor({ environment: env });
    await prEnv.dropAll();
  }
}

@AfterDeployment(project.name)
export class AfterDeploymentLogic implements InfraCallback<SfApiEnvironmentConfiguration> {
  async invoke(env: string, config: SfApiEnvironmentConfiguration): Promise<void> {
    // Cognito admin users creation
    // predefined cognito users and groups
    // preview environments need prefix for usernames to be unique
    // Does not update password in cognito when we're changing it
    const isPreview = PreviewEnvName.test(env);
    const prefix = isPreview ? `${env}_` : '';

    const ssm = new SsmEditor({ productName: ProjectName, environment: env });
    const credentials: any = await ssm.getConfigurationObject({
      parametersPrefix: `/${ProjectName}/${env}/auth/generic-credentials/`,
      transformKebabToCamel: false,
    });

    await syncCognitoUsers(config.authConfig.userPoolId, [
      {
        username: `${prefix}${credentials.adminusername}`,
        password: credentials.adminpassword,
        groupName: `${prefix}admin`,
      },
      {
        username: `${prefix}${credentials.hmusername}`,
        password: credentials.hmpassword,
        groupName: `${prefix}hm`,
      },
    ]);
  }
}
