import * as path from 'path';

/**
 * In this file we configure all paths
 * Please use relative paths to the closest known segment to easily adjust project structure for specific needs
 */

/**
 * Assuming the current folder structure this should be the root folder of the whole project (and repository)
 */
export const PROJECT_ROOT_PATH = path.resolve(__dirname, '../../../');
export const DEPLOYMENT_FOLDER = path.resolve(PROJECT_ROOT_PATH, 'deploy');
