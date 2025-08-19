import { APIGatewayProxyEventHeaders } from 'aws-lambda';
import { AxiosRequestConfig, AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';

export const ProxiedRequestHeaders = [
  'accept-encoding',
  'accept',
  'content-type',
  'content-encoding',
  'x-auth-client',
  'x-hmac-signature',
  'x-indeed-signature',
];

export const ProxiedResponseHeaders = [
  'date',
  'content-type',
  'vary',
  'transfer-encoding',
  'content-encoding',
  'content-disposition',
  'x-content-type-options',
  'access-control-expose-headers',
];

function filterHeaders(
  whitelist: string[],
  source: RawAxiosResponseHeaders | AxiosResponseHeaders | Record<string, string | undefined>,
) {
  return Object.keys(source)
    .filter((h) => whitelist.includes(h.toLowerCase()))
    .reduce((obj, key) => {
      obj[key] = source[key] as string;
      return obj;
    }, {} as { [header: string]: string });
}

export function passRequestHeaders(eventHeaders: APIGatewayProxyEventHeaders) {
  return filterHeaders(ProxiedRequestHeaders, eventHeaders);
}

export function passResponseHeaders(responseHeaders: RawAxiosResponseHeaders | AxiosResponseHeaders) {
  return { ...filterHeaders(ProxiedResponseHeaders, responseHeaders), 'Access-Control-Allow-Origin': '*' };
}

export function getOwnResponseHeaders() {
  return passResponseHeaders({ 'content-type': 'application/json' });
}

export function getBufferConfig(): AxiosRequestConfig {
  return {
    responseType: 'arraybuffer',
  };
}

export function getRedirectConfig(): AxiosRequestConfig {
  return {
    validateStatus: function (status) {
      return status >= 200 && status <= 302; // default
    },
    maxRedirects: 0,
  };
}
