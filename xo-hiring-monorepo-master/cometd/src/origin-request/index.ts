import https from 'https';
import AWS from 'aws-sdk';
import { CloudFrontHeaders, CloudFrontRequestHandler } from 'aws-lambda';

// 5 Minutes
const TokenCacheDuration = 300_000;

let lastTokenRefreshTime = 0;
let sfServiceToken: false | string = false;

type Env = { secretName: string; salesforceAuthApi: string };

const handler: CloudFrontRequestHandler = async (event) => {
  // Get request event
  const request = event.Records[0].cf.request;
  const env: Env = {
    secretName: request.origin?.custom?.customHeaders['x-crossover-secretname'][0].value as string,
    salesforceAuthApi: request.origin?.custom?.customHeaders['x-crossover-salesforceauthapi'][0].value as string,
  };

  if (!sfServiceToken || Date.now() - lastTokenRefreshTime >= TokenCacheDuration) {
    lastTokenRefreshTime = Date.now();
    await refreshAccessToken(env);
  }

  // Replace header
  setHeader(request.headers, 'authorization', `Bearer ${sfServiceToken}`);

  // Return modified request
  return request;
};

exports.handler = handler;

function setHeader(headers: CloudFrontHeaders, name: string, value: string) {
  headers[name] = [{ key: name, value }];
}

async function getServiceUserInfo(env: Env) {
  const secrets = new AWS.SecretsManager({ region: 'us-east-1' });
  const response = await secrets.getSecretValue({ SecretId: env.secretName }).promise();
  return JSON.parse(response.SecretString as string) as ServiceUser;
}

async function refreshAccessToken(env: Env) {
  const serviceUser = await getServiceUserInfo(env);
  const tokenData = await getAccessToken(env, serviceUser);
  sfServiceToken = tokenData.access_token;
}

type ServiceUser = {
  clientId: string;
  clientSecret: string;
  cometdUsername: string;
  cometdPassword: string;
  cometdToken: string;
};

function getAccessToken(env: Env, serviceUser: ServiceUser): Promise<{ access_token: string }> {
  return new Promise((resolve) => {
    const body =
      `grant_type=password` +
      `&client_id=${encodeURIComponent(serviceUser.clientId)}` +
      `&client_secret=${encodeURIComponent(serviceUser.clientSecret)}` +
      `&username=${encodeURIComponent(serviceUser.cometdUsername)}` +
      `&password=${encodeURIComponent(serviceUser.cometdPassword) + encodeURIComponent(serviceUser.cometdToken)}`;
    const req = https.request(
      `${env.salesforceAuthApi}/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
      (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));

        response.on('end', () => {
          resolve(JSON.parse(data));
        });
      },
    );
    req.write(body);
    req.end();
  });
}
