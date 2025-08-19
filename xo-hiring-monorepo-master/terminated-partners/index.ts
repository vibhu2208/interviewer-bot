import { loadData } from './dataSource';
import { getGoogleAccessToken } from './googleAuthorize';
import axios from 'axios';
import { readConfig } from './config';

/**
 * Loads config parameters from ParametersStore
 * Uses db config and sql query from loaded parameters to fetch data from Aurora
 * Posts fetched data to spreadsheet API
 */
export async function handler() {
  const appConfig = await readConfig(process.env.APP_CONFIG || '');
  const dbConfig = await readConfig(process.env.DB_CONFIG || '');

  const data = await loadData(dbConfig, appConfig.sql);
  await postData(appConfig, data);
}

/**
 * Posts data to Google WebApp API endpoint
 * @param appConfig WebApp and spreadsheet configuration (endpoint, sheet)
 * @param data resultSet from the query
 */
async function postData(
  appConfig: { googleAccess: string; viewEndpoint: string; spreadsheetId: string; sheetName: string; pk: string },
  data: unknown,
) {
  const googleAccessConfig = await readConfig(process.env.GOOGLE_ACCESS_CONFIG || '');
  const token = await getGoogleAccessToken(googleAccessConfig);
  //invoke Spreadsheet API
  await axios.post(
    appConfig.viewEndpoint, //endpoint
    {
      spreadsheetId: appConfig.spreadsheetId,
      sheetName: appConfig.sheetName,
      pk: appConfig.pk,
      data: data,
    }, // fileBuffer
    {
      //LAMBDA-21747 - FIX: Request body larger than maxBodyLength limit
      // see axios documentation (https://github.com/axios/axios)
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      }, // config
    },
  );
}
