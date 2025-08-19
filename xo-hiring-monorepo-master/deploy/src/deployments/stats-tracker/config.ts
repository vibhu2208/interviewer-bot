import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  AfterDeployment,
  AwsConfig,
  Configuration,
  Configurator,
  Infra,
  InfraCallback,
} from '@trilogy-group/lambda-cdk-infra';
import * as fs from 'fs';
import * as path from 'path';
import { isPreview, PreviewEnvName, ProductionEnvName, ProjectName, SandEnvName } from '../../config/environments';
import { Projects } from '../../config/projects';
import { EnvironmentType } from '../../utils/lambda-helpers';
import { project, SfApiEnvironmentConfiguration } from '../sf-api/sf-api-config';
import { ProjectStructure } from './paths';

export const Project = Projects['stats-tracker'];

export class StatsTrackerConfig {
  ownbackupUserName: string;

  envOverrides?: {
    ownbackupSecretName: string;
    trackerGeneratorSecretName: string;
    kontentExporterSecretName: string;
    backupBucketName: string;
  };

  failureSNSArn: string | null;
  glue: {
    crawlerRoleName: string;
  };

  trackerTarget: {
    titlePrefix: (envName: string) => string;
    spreadsheetId: string | null;
    sheetId: string | null;
  };

  openSearch: {
    getSsmConfigParameter: (envName: string) => string[];
    getSsmServiceAccountParameter: (envName: string) => string[];
    getAthenaDb: (envName: string) => string;
    getAthenaOutputLocation: (envName: string) => string;
  };

  ddbToAthenaSync: {
    tableMappings: Array<{
      ddbTableName: string;
      athenaTableName: string;
    }>;
  };

  envType: EnvironmentType;
}

const DefaultStatsTrackerConfig = {
  ownbackupUserName: 'ownbackup',
  failureSNSArn: null,
  glue: {
    crawlerRoleName: 'aws-glue-allow-all',
  },
  ddbToAthenaSync: {
    tableMappings: [
      {
        ddbTableName: 'xo-hiring-interview-bot-sandbox-main',
        athenaTableName: 'interview_bot',
      },
      {
        ddbTableName: 'xo-hiring-interview-assist-sandbox-data',
        athenaTableName: 'interview_assist',
      },
    ],
  },
};

// Returns sandbox for preview environments
export const pEnv = (envName: string) => (isPreview(envName) ? SandEnvName : envName);

const DefaultOpenSearchConfig = {
  getSsmConfigParameter: (envName: string) => [`/xo-hiring/${envName}/open-search/config`],
  getSsmServiceAccountParameter: (envName: string) => [`/xo-hiring/${envName}/common/salesforce-service-account`],
  getAthenaDb: (envName: string) => `xo-hiring-${pEnv(envName)}-stats-tracker-backup`,
  getAthenaOutputLocation: (envName: string) => `s3://xo-${pEnv(envName)}-athena-query-results/`,
};

@Configuration(Project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<StatsTrackerConfig> {
  config(): StatsTrackerConfig {
    return {
      ...DefaultStatsTrackerConfig,
      failureSNSArn: 'arn:aws:sns:us-east-1:104042860393:xo-hire-stats-tracker-failures',
      trackerTarget: {
        titlePrefix: () => '',
        spreadsheetId: '1mp5QDlIor1yS_ydErLXA761TXSAidTAylgn-nE-Dstg',
        sheetId: '1375204677',
      },
      openSearch: {
        ...DefaultOpenSearchConfig,
      },
      ddbToAthenaSync: {
        tableMappings: [
          {
            ddbTableName: 'xo-hiring-interview-bot-production-main',
            athenaTableName: 'interview_bot',
          },
          {
            ddbTableName: 'xo-hiring-interview-assist-production-data',
            athenaTableName: 'interview_assist',
          },
        ],
      },
      envType: EnvironmentType.Production,
    };
  }
}

@Configuration(Project.name, SandEnvName)
export class SandboxConfig implements Configurator<StatsTrackerConfig> {
  config(): StatsTrackerConfig {
    return {
      ...DefaultStatsTrackerConfig,
      trackerTarget: {
        titlePrefix: (e) => `[${e.toUpperCase()}] `,
        spreadsheetId: '1XrR1erxVJrdZzsET88A0t5meScydIlbwGl6f3cNW3QM',
        sheetId: '0',
      },
      openSearch: {
        ...DefaultOpenSearchConfig,
      },
      envType: EnvironmentType.Sandbox,
    };
  }
}

@Configuration(Project.name, PreviewEnvName)
export class PreviewConfig extends SandboxConfig {
  config(): StatsTrackerConfig {
    const baseCfg = super.config();
    // use sandbox resources for previews
    baseCfg.envOverrides = {
      ownbackupSecretName: `${ProjectName}-${SandEnvName}-stats-tracker-ownbackup-secret`,
      trackerGeneratorSecretName: `${ProjectName}-${SandEnvName}-stats-tracker-tracker-refresher-secret`,
      backupBucketName: `${ProjectName}-${SandEnvName}-stats-tracker-ownbackup-bucket`,
      kontentExporterSecretName: `${ProjectName}-${SandEnvName}-stats-tracker-kontent-export-secret`,
    };

    // create new spreadsheet every time
    baseCfg.trackerTarget.spreadsheetId = null;
    baseCfg.envType = EnvironmentType.Preview;
    return baseCfg;
  }
}

const handleSingleFileAssetDeployment = async (
  bucketName: string,
  filePrefix: string,
  filePath: string,
  s3: S3Client,
) => {
  // Check if the file exists in the bucket
  const fullFilePath = filePrefix + filePath;

  const params = {
    Bucket: bucketName,
    Key: fullFilePath,
  };

  try {
    await s3.send(new HeadObjectCommand(params));
    console.log(`File ${fullFilePath} already exists in S3 bucket ${bucketName}.`);
  } catch (err) {
    try {
      // File doesn't exist, so upload it from local folder
      const fileContent = fs.readFileSync(path.resolve(ProjectStructure.assets, filePath));

      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucketName,
          Key: fullFilePath,
          Body: fileContent,
        },
      });

      await upload.done();
      console.log(`File ${filePath} uploaded to S3 bucket ${bucketName}.`);
    } catch (err) {
      console.error(`Error uploading file ${filePath} to S3 bucket ${bucketName}: ${err}`);
    }
  }
};

@AfterDeployment(project.name)
export class AfterDeploymentLogic implements InfraCallback<SfApiEnvironmentConfiguration> {
  async invoke(env: string): Promise<void> {
    console.log('current working directory', process.cwd());
    const bfqBucketName = Infra.generateResourceName('bfq', env);
    console.log(`bfqBucketName: ${bfqBucketName}`);
    const s3 = new S3Client({ credentials: AwsConfig.defaultCredentials() });

    await handleSingleFileAssetDeployment(bfqBucketName, 'config/', 'bfq-questions.jsonc', s3);
    await handleSingleFileAssetDeployment(bfqBucketName, 'config/', 'bfq-answers.schema.json', s3);
    await handleSingleFileAssetDeployment(bfqBucketName, 'config/', 'bfq-answers-job-role.schema.json', s3);
  }
}
