import * as path from 'path';

import { ProjectDefinition } from './model';
import { PROJECT_ROOT_PATH } from './paths';

export const Projects: { [name: string]: ProjectDefinition } = {
  cometd: {
    name: 'cometd',
    path: path.join(PROJECT_ROOT_PATH, 'cometd'),
    stackNames: async () => {
      return [Projects['cometd'].name];
    },
  },
  'sf-api': {
    name: 'sf-api',
    path: path.join(PROJECT_ROOT_PATH, 'sf-api'),
    stackNames: async () => {
      return [Projects['sf-api'].name];
    },
  },
  'kontent-api': {
    name: 'kontent-api',
    path: path.join(PROJECT_ROOT_PATH, 'kontent-api'),
    stackNames: async () => {
      return [Projects['kontent-api'].name];
    },
  },
  uploadavatar: {
    name: 'uploadavatar',
    path: path.join(PROJECT_ROOT_PATH, 'uploadavatar'),
    stackNames: async () => {
      return [Projects['uploadavatar'].name];
    },
  },
  'site-recacher': {
    name: 'site-recacher',
    path: path.join(PROJECT_ROOT_PATH, 'site-recacher'),
    stackNames: async () => {
      return [Projects['site-recacher'].name];
    },
  },
  'terminated-partners': {
    name: 'terminated-partners',
    path: path.join(PROJECT_ROOT_PATH, 'terminated-partners'),
    stackNames: async () => {
      return [Projects['terminated-partners'].name];
    },
  },
  'sandbox-refresh': {
    name: 'sandbox-refresh',
    path: path.join(PROJECT_ROOT_PATH, 'sandbox-refresh'),
    stackNames: async () => {
      return [Projects['sandbox-refresh'].name];
    },
  },
  'stats-tracker': {
    name: 'stats-tracker',
    path: path.join(PROJECT_ROOT_PATH, 'stats-tracker'),
    stackNames: async () => {
      return [Projects['stats-tracker'].name];
    },
  },
  'sf-updater': {
    name: 'sf-updater',
    path: path.join(PROJECT_ROOT_PATH, 'sf-updater'),
    stackNames: async () => {
      return [Projects['sf-updater'].name];
    },
  },
  'sf-process-raw-applications': {
    name: 'sf-process-raw-applications',
    path: path.join(PROJECT_ROOT_PATH, 'sf-process-raw-applications'),
    stackNames: async () => {
      return [Projects['sf-process-raw-applications'].name];
    },
  },
  auth: {
    name: 'auth',
    path: path.join(PROJECT_ROOT_PATH, 'packages/candidate-cognito-auth'),
    stackNames: async () => {
      return [Projects['auth'].name];
    },
  },
  automations: {
    name: 'automations',
    path: path.join(PROJECT_ROOT_PATH, 'packages/automations'),
    stackNames: async () => {
      return [Projects['automations'].name];
    },
  },
  watcher: {
    name: 'watcher',
    path: path.join(PROJECT_ROOT_PATH, 'watcher'),
    stackNames: async () => {
      return [Projects['watcher'].name];
    },
  },
  'grading-bot': {
    name: 'grading-bot',
    path: path.join(PROJECT_ROOT_PATH, 'grading-bot'),
    stackNames: async () => {
      return [Projects['grading-bot'].name];
    },
  },
  'interview-bot': {
    name: 'interview-bot',
    path: path.join(PROJECT_ROOT_PATH, 'interview-bot'),
    stackNames: async () => {
      return [Projects['interview-bot'].name];
    },
  },
  'xo-ai-coach': {
    name: 'xo-ai-coach',
    path: path.join(PROJECT_ROOT_PATH, 'xo-ai-coach'),
    stackNames: async () => {
      return [Projects['xo-ai-coach'].name];
    },
  },
  'sf-exceptions': {
    name: 'sf-exceptions',
    path: path.join(PROJECT_ROOT_PATH, 'sf-exceptions-proxy'),
    stackNames: async () => {
      return [Projects['sf-exceptions'].name];
    },
  },
  'bfq-verification': {
    name: 'bfq-verification',
    path: path.join(PROJECT_ROOT_PATH, 'bfq-verification'),
    stackNames: async () => {
      return [Projects['bfq-verification'].name];
    },
  },
};
