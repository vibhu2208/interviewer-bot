/**
 * Change according to your project name (use alphanumerical characters)
 */
import { EnvironmentConfiguration, EnvironmentWrapper } from './model';
import * as util from '@aws-sdk/util-arn-parser';
import { RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export const ProjectName = 'xo-hiring';

/**
 * TODO: Use this function until lambda-infra-lib fixes it's naming scheme
 * @param config Stack config.
 * @param resourceName Resource name (unique within your stack).
 * @returns Resource name
 */
export function generateStackResourceName(config: StackConfig, resourceName: string): string {
  // e.g. xo-hiring-sandbox-stats-tracker-ownbackup-exporter
  const name = `${config.stackName}-${resourceName}`;
  return name;
}

export function getSsmValue(stack: RootStack, name: string) {
  // You can also use an existing parameter by looking up the parameter from the AWS environment.
  const value = ssm.StringParameter.valueFromLookup(
    stack,
    `/${stack.config.infraConfig.projectName}/${stack.config.environmentName}/${name}`,
  );
  return value;
}

/**
 * Default env names. Can be changed to a different values
 */
export const ProductionEnvName = 'production';
export const SandEnvName = 'sandbox';
export const PreviewEnvName = /^pr\d+$/;

export const isPreview = (envName: string) => PreviewEnvName.test(envName);
export const isProduction = (envName: string) => ProductionEnvName === envName;

export const AWSAccount = '104042860393';
export const AWSRegion = 'us-east-1';

/**
 * The current environment name will be stored here (we use object to avoid cyclic references and scope issues)
 */
export const Environment: EnvironmentWrapper = {
  Current: undefined,
  Config: undefined,
};

/**
 * This config is a basic one - everything similar for all envs goes here
 */
const DefaultEnvConfig = {};

export const DefaultDnsConfig = {
  hostedZoneId: 'Z1UY6RF8Q87GR8',
  hostedZoneName: 'crossover.com',
  viewerCertificateArn: util.build({
    accountId: AWSAccount,
    region: AWSRegion,
    service: 'acm',
    resource: 'certificate/4665a8b4-c8c2-4a62-932a-32235a02cb05',
  }),
  ttlSec: 3600,
};
const DefaultSandboxRefreshConfig = {
  secretsKey: 'xo-hiring-admin-production/service-user',
};

export const ORP_NO_HEADERS_ID = 'f98d34e1-a5dc-40e4-8bda-710209ba2967';
export const FORWARD_X_AUTH_AND_X_HMAC_HEADER_ID = 'b6ba69e7-89ff-4c1b-b660-f8a225f652d8';
export const FORWARD_ALL = 'b689b0a8-53d0-40ab-baf2-68738e2966ac';

/**
 * Production-specific configuration values (extends default config)
 */
export const ProdEnvConfig: EnvironmentConfiguration = {
  ...DefaultEnvConfig,
  terminatedPartners: {
    AppConfig: 'TerminatedPartners-AppConfig',
    versionAppConfig: 3,
    Db: 'TerminatedPartners-DB',
    versionDb: 4,
    GoogleServiceUser: 'TerminatedPartners-GoogleServiceUser',
    versionGoogleServiceUser: 2,
    resources: [
      'arn:aws:ssm:us-east-1:104042860393:parameter/TerminatedPartners-AppConfig',
      'arn:aws:ssm:us-east-1:104042860393:parameter/TerminatedPartners-DB',
      'arn:aws:ssm:us-east-1:104042860393:parameter/TerminatedPartners-GoogleServiceUser',
    ],
    vpcId: 'vpc-490ec62c',
    securityGroupId: 'sg-0a203141',
    subnetIds: ['subnet-0541c25271b86fb30', 'subnet-01386e57c2abfa84f'],
  },
  sandboxRefreshConfig: {
    ...DefaultSandboxRefreshConfig,
  },
};

/**
 * Dev-specific configuration values (extends default config)
 */
export const SandEnvConfig: EnvironmentConfiguration = {
  ...DefaultEnvConfig,
  terminatedPartners: {
    AppConfig: 'TerminatedPartners-AppConfig',
    versionAppConfig: 3,
    Db: 'TerminatedPartners-DB',
    versionDb: 4,
    GoogleServiceUser: 'TerminatedPartners-GoogleServiceUser',
    versionGoogleServiceUser: 2,
    resources: [],
    vpcId: 'vpc-490ec62c',
    securityGroupId: 'sg-0a203141',
    subnetIds: ['subnet-0541c25271b86fb30', 'subnet-01386e57c2abfa84f'],
  },
  sandboxRefreshConfig: {
    ...DefaultSandboxRefreshConfig,
  },
};

/**
 * Preview-specific configuration values (extends sandbox config)
 */
export const PreviewEnvConfig: EnvironmentConfiguration = {
  ...SandEnvConfig,
};
