import { Configuration, Configurator } from '@trilogy-group/lambda-cdk-infra';
import * as path from 'path';
import { PreviewEnvName, ProductionEnvName, SandEnvName } from '../../config/environments';
import { Projects } from '../../config/projects';

export const project = Projects['sf-updater'];

const wmLocationAthenaQueryInputConfig: Omit<AthenaQueryInputConfig, 'databaseName'> = {
  inputType: 'athenaQuery',
  querySourceFile: path.resolve(project.path, 'athena', 'worldMapLocationStats.sql'),
};

const wmLocationUpdateFlow: AppFlowConfig = {
  objectType: 'World_Map_Location__c',
  writeOperationType: 'UPDATE',
  fieldConfigs: [
    {
      name: 'Avg_Weekly_Views__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'Avg_Weekly_Clicks__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'AdvertisementWeeks__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'MQLTestTakers__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'MQLs__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'SQLTestTakers__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'SQLs__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'InterviewTestTakers__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'InterviewPassers__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'Hires__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'Applications_From_All_Channels__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'Applications_From_Indeed__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'CCAT_Passers__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
    {
      name: 'Average_CPA_for_Indeed__c',
      sourceDataType: 'string',
      destinationDataType: 'double',
    },
  ],
};

export type FieldConfig = {
  /**
   * Name of the field. Currently, it should always be the same in CSV header and Salesforce.
   *
   * This is so-called "API name", or "full name" of the field, not a label
   */
  name: string;
  sourceDataType: string;
  destinationDataType: string;
};

export type AppFlowConfigBase = {
  /**
   * Salesforce organization object type.
   *
   * Once deployed, it should never be changed for the flow name.
   *
   * If you need th change it, create a new flow with different name.
   *
   */
  objectType: string;

  /**
   * The scheduling expression that determines the rate at which the schedule will run, for example `rate(5minutes)` .
   *
   * Optional. If not set, OnDemand flow triger type will be used.
   *
   * @link http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-appflow-flow-scheduledtriggerproperties.html#cfn-appflow-flow-scheduledtriggerproperties-scheduleexpression
   */
  scheduleExpression?: string;

  /**
   * Specifies if the flow should fail after the first instance of a failure when attempting to place data in the destination.
   *
   * By default, true
   *
   * @link http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-appflow-flow-errorhandlingconfig.html#cfn-appflow-flow-errorhandlingconfig-failonfirsterror
   */
  failOnFirstError?: boolean;
};

export type UpsertAppFlowConfig = AppFlowConfigBase & {
  writeOperationType: 'UPSERT';
  externalIdFieldName: string;
  fieldConfigs: FieldConfig[];
};

export type DeleteAppFlowConfig = AppFlowConfigBase & {
  writeOperationType: 'DELETE';
};

export type UpdateAppFlowConfig = AppFlowConfigBase & {
  writeOperationType: 'UPDATE';
  fieldConfigs: FieldConfig[];
};

export type InsertAppFlowConfig = AppFlowConfigBase & {
  writeOperationType: 'INSERT';
  fieldConfigs: FieldConfig[];
};

export type AppFlowConfig = InsertAppFlowConfig | UpdateAppFlowConfig | DeleteAppFlowConfig | UpsertAppFlowConfig;

export type AthenaQueryInputConfig = {
  inputType: 'athenaQuery';
  querySourceFile: string;
  databaseName: string;
};

export type FlowConfig = {
  inputConfig: AthenaQueryInputConfig;
  appflowConfig: AppFlowConfig;
  failureSNSArn?: string;
  /**
   * If set, state machine run will be scheduled.
   *
   * Syntax: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html#eb-cron-expressions
   */
  cronExpression?: string;
};

export type SfUpdaterConfig = {
  salesforceConnectorProfileName: string;
  localSourceFolder?: string;
  flows: Record<string, FlowConfig>;
};

@Configuration(project.name, ProductionEnvName)
export class ProductionConfigurator implements Configurator<SfUpdaterConfig> {
  config(): SfUpdaterConfig {
    return {
      salesforceConnectorProfileName: 'production',
      flows: {
        worldMapLocation: {
          appflowConfig: wmLocationUpdateFlow,
          inputConfig: {
            ...wmLocationAthenaQueryInputConfig,
            databaseName: 'xo-hiring-production-stats-tracker-backup',
          },
          failureSNSArn: 'arn:aws:sns:us-east-1:104042860393:xo-hire-failures',
          // Every Sunday
          cronExpression: '0 0 ? * SUN *',
        },
      },
    };
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfigurator implements Configurator<SfUpdaterConfig> {
  config(): SfUpdaterConfig {
    return {
      salesforceConnectorProfileName: 'fullshared',
      flows: {
        worldMapLocation: {
          appflowConfig: wmLocationUpdateFlow,
          inputConfig: {
            ...wmLocationAthenaQueryInputConfig,
            databaseName: 'xo-hiring-sandbox-stats-tracker-backup',
          },
          // Every Sunday
          cronExpression: '0 0 ? * SUN *',
        },
      },
    };
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfigurator implements Configurator<SfUpdaterConfig> {
  config(): SfUpdaterConfig {
    return {
      salesforceConnectorProfileName: 'fullshared',
      flows: {},
      localSourceFolder: 'appFlow/preview',
    };
  }
}
