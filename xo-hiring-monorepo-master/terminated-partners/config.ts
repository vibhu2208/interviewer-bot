import AWS from 'aws-sdk';
const SSM = new AWS.SSM();

/**
 * Read config from AWS ParameterStore
 * @param configParameterName parameter name
 * @returns config
 */
export async function readConfig(configParameterName: string) {
  const config = (
    await SSM.getParameter({
      Name: configParameterName,
      WithDecryption: true,
    }).promise()
  ).Parameter?.Value;
  return JSON.parse(config || '');
}
