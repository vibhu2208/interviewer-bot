import * as path from 'path';

const toRepositoryRoot = '../../../../';
const projectPath = path.resolve(__dirname, toRepositoryRoot, 'stats-tracker');

const ownbackupExporterLambda = path.resolve(projectPath, 'ownbackup-exporter');
const ownbackupExporterLambdaDist = path.resolve(ownbackupExporterLambda, 'dist');

const trackerRefresherLambda = path.resolve(projectPath, 'tracker-refresher');
const trackerRefresherLambdaDist = path.resolve(trackerRefresherLambda, 'dist');

const kontentExporterLambda = path.resolve(projectPath, 'kontent-exporter');
const kontentExporterLambdaDist = path.resolve(kontentExporterLambda, 'dist');

export const ProjectStructure = {
  ownbackupExporterLambda,
  ownbackupExporterLambdaDistCode: path.resolve(ownbackupExporterLambdaDist, 'code'),
  ownbackupExporterLambdaDistLayer: path.resolve(ownbackupExporterLambdaDist, 'layer'),

  trackerRefresherLambda,
  trackerRefresherLambdaDistCode: path.resolve(trackerRefresherLambdaDist, 'code'),
  trackerRefresherLambdaDistLayer: path.resolve(trackerRefresherLambdaDist, 'layer'),

  kontentExporterLambda,
  kontentExporterLambdaDistCode: path.resolve(kontentExporterLambdaDist, 'code'),
  kontentExporterLambdaDistLayer: path.resolve(kontentExporterLambdaDist, 'layer'),

  jobAsset: path.resolve(__dirname, 'job-asset'),
  assets: path.resolve(__dirname, 'assets'),
};
