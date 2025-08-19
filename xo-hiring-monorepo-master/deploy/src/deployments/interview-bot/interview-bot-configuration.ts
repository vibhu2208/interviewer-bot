import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import {
  AfterDeployment,
  AfterDestruction,
  Configuration,
  Configurator,
  Infra,
  InfraCallback,
  LambdaBuilders,
  Prepare,
  PrepareCallback,
  PrepareConfig,
  StackUtils,
} from '@trilogy-group/lambda-cdk-infra';
import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';
import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as fg from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectName } from '../../config/environments';
import { PROJECT_ROOT_PATH } from '../../config/paths';
import { EnvironmentType } from '../../utils/lambda-helpers';

export const InterviewBotProjectName = 'interview-bot';
export const InterviewBotBackendStackName = 'interview-bot-backend';
export const GraphQLSchemaFile = path.resolve(PROJECT_ROOT_PATH, 'interview-bot/schema.graphql');
export const GraphQLResolversProject = path.resolve(PROJECT_ROOT_PATH, 'interview-bot/graphql-resolvers');
export const LambdaProject = path.resolve(PROJECT_ROOT_PATH, 'interview-bot/lambda');
export const DynamoDbTableNameOutput = 'DynamoDbTableNameOutput';
export const RestApiUrl = 'RestApiUrl';
export const GraphQLApiUrl = 'GraphQLApiUrl';

export interface InterviewBotConfiguration {
  ddbDeletionProtection: boolean;
  removalPolicy: RemovalPolicy;
  enableXRay: boolean;
  logRetention: RetentionDays;
  restApiDomainName: (env: string) => string;
  gqlApiDomainName: (env: string) => string;
  domainCertificateArn: string;
  hostedZone: string;
  frontendUrl: string;
  openaiSecretName: string;
  failureSnsTopic?: string;
  athenaDatabaseName: string;
  envType: EnvironmentType;
}

@Configuration(InterviewBotProjectName, 'production')
export class InterviewBotConfigurationProduction implements Configurator<InterviewBotConfiguration> {
  config(): InterviewBotConfiguration {
    return {
      ddbDeletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      enableXRay: true,
      logRetention: RetentionDays.FOUR_MONTHS,
      restApiDomainName: () => `assessments-api-rest.crossover.com`,
      gqlApiDomainName: () => `assessments-api-gql.crossover.com`,
      domainCertificateArn: 'arn:aws:acm:us-east-1:104042860393:certificate/4665a8b4-c8c2-4a62-932a-32235a02cb05',
      hostedZone: 'crossover.com',
      frontendUrl: 'https://assessments.crossover.com',
      openaiSecretName: 'xo-hiring/integration/production/openai',
      failureSnsTopic: 'xo-hire-failures',
      athenaDatabaseName: 'xo-hiring-production-stats-tracker-backup',
      envType: EnvironmentType.Production,
    };
  }
}

@Configuration(InterviewBotProjectName, 'sandbox')
export class InterviewBotConfigurationSandbox implements Configurator<InterviewBotConfiguration> {
  config(): InterviewBotConfiguration {
    return {
      ddbDeletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      enableXRay: false,
      logRetention: RetentionDays.ONE_WEEK,
      restApiDomainName: (env) => `${env}-assessments-api-rest.crossover.com`,
      gqlApiDomainName: (env) => `${env}-assessments-api-gql.crossover.com`,
      domainCertificateArn: 'arn:aws:acm:us-east-1:104042860393:certificate/4665a8b4-c8c2-4a62-932a-32235a02cb05',
      hostedZone: 'crossover.com',
      frontendUrl: 'https://sandbox-assessments.crossover.com', // Always use sandbox frontend for non-prod envs for now
      openaiSecretName: 'xo-hiring/integration/sandbox/openai',
      athenaDatabaseName: 'xo-hiring-sandbox-stats-tracker-backup',
      envType: EnvironmentType.Sandbox,
    };
  }
}

@Configuration(InterviewBotProjectName)
export class InterviewBotConfigurationTemp extends InterviewBotConfigurationSandbox {
  config(): InterviewBotConfiguration {
    return {
      ...super.config(),
      envType: EnvironmentType.Preview,
    };
  }
}

@Prepare(InterviewBotProjectName)
export class PrepareProject implements PrepareCallback {
  async invoke(config: PrepareConfig): Promise<void> {
    let buildResult = LambdaBuilders.prepareNpmTsProject(GraphQLResolversProject, {
      ...config,
      prepareLayer: false,
    });

    buildResult &&= LambdaBuilders.prepareNpmTsProject(LambdaProject, config);

    if (buildResult) {
      // Remove all .ts and .md files from the lambda layer
      const layerPath = path.join(LambdaProject, 'dist/layer');
      const filesToRemove = await fg.glob(['**/*.ts', '**/*.md'], { cwd: layerPath });

      for (const file of filesToRemove) {
        const filePath = path.join(layerPath, file);
        fs.unlinkSync(filePath);
      }
    }

    if (!buildResult) {
      throw new Error('prepareNpmTsProject result is not successful.');
    }
  }
}

@AfterDeployment(InterviewBotProjectName)
export class AfterDeploymentLogic implements InfraCallback<InterviewBotConfiguration> {
  async invoke(env: string, config: InterviewBotConfiguration): Promise<void> {
    // DDB Data Seeding
    const stackName = Infra.generateResourceName(InterviewBotBackendStackName, env);
    const stackData = await StackUtils.describeStack(stackName);
    const ddbTableName = stackData.outputs[DynamoDbTableNameOutput];
    if (ddbTableName != null) {
      const client = new DynamoDBClient({});
      const documentClient = DynamoDBDocument.from(client);

      console.log(`Performing data seeding into DDB Table ${ddbTableName}`);
      const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, './data/ddb-data.json')).toString('utf-8'));

      for (const document of data) {
        try {
          await documentClient.put({
            TableName: ddbTableName,
            Item: document,
            ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
          });
          console.log(`Inserted item PK=${document.pk};SK=${document.sk}`);
        } catch (e) {
          if (e instanceof ConditionalCheckFailedException) {
            console.log(`Duplicated item PK=${document.pk};SK=${document.sk}`);
          } else {
            console.error('Error while inserting data into DDB', e);
          }
        }
      }
    }
  }
}

@AfterDestruction(InterviewBotProjectName)
export class AfterDestructionLogic implements InfraCallback<InterviewBotConfiguration> {
  async invoke(env: string, config: InterviewBotConfiguration): Promise<void> {
    // Remove all SSM parameters for the preview environment on destroy
    if (config.envType === EnvironmentType.Preview) {
      console.log(`Dropping all SSM parameters for env: ${env}`);
      const preview = new SsmEditor({ productName: ProjectName, environment: env });
      await preview.dropAll();
    }
  }
}
