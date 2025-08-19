import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import {
  AfterDeployment,
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
import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as fg from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_ROOT_PATH } from '../../config/paths';
import { EnvironmentType } from '../../utils/lambda-helpers';

export const InterviewAssistProjectName = 'interview-assist';
export const InterviewAssistBackendStackName = 'interview-assist-backend';
export const InterviewAssistLambdaProject = path.resolve(PROJECT_ROOT_PATH, 'packages/interview-assist');
export const DynamoDbTableNameOutput = 'DynamoDbTableNameOutput';
export const RestApiUrl = 'RestApiUrl';

export interface InterviewAssistConfiguration {
  deletionProtection: boolean;
  removalPolicy: RemovalPolicy;
  logRetention: RetentionDays;
  restApiDomainName: (env: string) => string;
  domainCertificateArn: string;
  hostedZone: string;
  envType: EnvironmentType;
  dailyReminderEnabled: boolean;
  userPoolId: string;
  interviewBotTableName: string;
  interviewBotApiUrl: (env: string) => string;
}

@Configuration(InterviewAssistProjectName, 'production')
export class InterviewAssistConfigurationProduction implements Configurator<InterviewAssistConfiguration> {
  config(): InterviewAssistConfiguration {
    return {
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      logRetention: RetentionDays.FOUR_MONTHS,
      restApiDomainName: () => `interview-assist-api.crossover.com`,
      domainCertificateArn: 'arn:aws:acm:us-east-1:104042860393:certificate/4665a8b4-c8c2-4a62-932a-32235a02cb05',
      hostedZone: 'crossover.com',
      envType: EnvironmentType.Production,
      dailyReminderEnabled: true,
      userPoolId: 'us-east-1_4HInMoHb2',
      interviewBotTableName: 'xo-hiring-interview-bot-production-main',
      interviewBotApiUrl: () => `https://assessments-api-rest.crossover.com`,
    };
  }
}

@Configuration(InterviewAssistProjectName, 'sandbox')
export class InterviewAssistConfigurationSandbox extends InterviewAssistConfigurationProduction {
  config(): InterviewAssistConfiguration {
    return {
      ...super.config(),
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      logRetention: RetentionDays.ONE_WEEK,
      restApiDomainName: (env: string) => `interview-assist-api-${env}.crossover.com`,
      envType: EnvironmentType.Sandbox,
      dailyReminderEnabled: false,
      userPoolId: 'us-east-1_c3Dd1dx3i',
      interviewBotTableName: 'xo-hiring-interview-bot-sandbox-main',
      interviewBotApiUrl: () => `https://sandbox-assessments-api-rest.crossover.com`,
    };
  }
}

@Configuration(InterviewAssistProjectName)
export class InterviewAssistConfigurationPreview extends InterviewAssistConfigurationSandbox {
  config(): InterviewAssistConfiguration {
    return {
      ...super.config(),
      logRetention: RetentionDays.ONE_DAY,
      envType: EnvironmentType.Preview,
      dailyReminderEnabled: false,
    };
  }
}

@Prepare(InterviewAssistProjectName)
export class PrepareProject implements PrepareCallback {
  async invoke(config: PrepareConfig): Promise<void> {
    const buildResult = LambdaBuilders.prepareNpmTsProject(InterviewAssistLambdaProject, config);

    if (buildResult) {
      // Remove all .ts and .md files from the lambda layer
      const layerPath = path.join(InterviewAssistLambdaProject, 'dist/layer');
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

@AfterDeployment(InterviewAssistProjectName)
export class AfterDeploymentLogic implements InfraCallback<InterviewAssistConfiguration> {
  async invoke(env: string, config: InterviewAssistConfiguration): Promise<void> {
    // DDB Data Seeding
    const stackName = Infra.generateResourceName(InterviewAssistBackendStackName, env);
    const stackData = await StackUtils.describeStack(stackName);
    const ddbTableName = stackData.outputs[DynamoDbTableNameOutput];
    if (ddbTableName != null) {
      const client = new DynamoDBClient({});
      const documentClient = DynamoDBDocument.from(client);

      console.log(`Performing data seeding into DDB Table ${ddbTableName}`);
      const data = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, './data/interview-assist-ddb-data.json')).toString('utf-8'),
      );

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
