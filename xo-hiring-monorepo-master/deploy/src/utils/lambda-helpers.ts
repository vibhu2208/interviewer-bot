import * as iam from 'aws-cdk-lib/aws-iam';
import * as util from '@aws-sdk/util-arn-parser';
import { AWSAccount, AWSRegion, ProjectName } from '../config/environments';

export enum EnvironmentType {
  Production = 'production',
  Sandbox = 'sandbox',
  Preview = 'preview',
}

export function ssmPolicy(envName: string): iam.PolicyStatement {
  return new iam.PolicyStatement({
    resources: [
      util.build({
        service: 'ssm',
        region: AWSRegion,
        accountId: AWSAccount,
        resource: `parameter/${ProjectName}/${envName}/*`,
      }),
    ],
    actions: ['*'],
  });
}

export function secretAccess(secretName: string): iam.PolicyStatement {
  return new iam.PolicyStatement({
    resources: [
      util.build({
        accountId: AWSAccount,
        region: AWSRegion,
        service: 'secretsmanager',
        resource: `secret:${secretName}-??????`,
      }),
    ],
    actions: ['secretsmanager:GetSecretValue'],
  });
}

export function athenaBucketAccess(type: EnvironmentType): iam.PolicyStatement {
  const stableEnv = type === EnvironmentType.Production ? EnvironmentType.Production : EnvironmentType.Sandbox;
  return new iam.PolicyStatement({
    resources: [
      `arn:aws:s3:::xo-${stableEnv}-athena-query-results*`,
      `arn:aws:s3:::xo-hiring-${stableEnv}-stats-tracker-ownbackup-bucket*`,
    ],
    actions: ['s3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject'],
  });
}

export function openAiSecretName(type: EnvironmentType): string {
  switch (type) {
    case EnvironmentType.Production:
      return 'xo-hiring/integration/production/openai';
    default:
      return 'xo-hiring/integration/sandbox/openai';
  }
}

export function kontentSecretName(type: EnvironmentType): string {
  switch (type) {
    case EnvironmentType.Production:
      return 'xo-hiring-admin-production/kontent-ai';
    default:
      return 'xo-hiring-admin-sand/kontent-ai';
  }
}

export function indeedSecretName(type: EnvironmentType): string {
  switch (type) {
    case EnvironmentType.Production:
      return 'xo-hiring/integration/production/indeed';
    default:
      return 'xo-hiring/integration/sandbox/indeed';
  }
}

export function recaptchaSecretName(): string {
  return 'xo-hiring/integration/production/google-recaptcha';
}

export function salesforceSSMParameterName(type: EnvironmentType): string {
  switch (type) {
    case EnvironmentType.Production:
      return 'parameter/xo-hiring/production/salesforceAuthorizer';
    default:
      return 'parameter/xo-hiring/sandbox/salesforceAuthorizer';
  }
}

export function envSSMParametersName(type: EnvironmentType): string {
  switch (type) {
    case EnvironmentType.Production:
      return 'parameter/xo-hiring/production/*';
    default:
      return 'parameter/xo-hiring/sandbox/*';
  }
}
