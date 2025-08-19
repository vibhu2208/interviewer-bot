import { APIGatewayProxyResult } from 'aws-lambda';
import { AxiosRequestConfig, AxiosResponse, AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';
import { AuthorizationError } from './authorization';
import { getOwnResponseHeaders, passResponseHeaders } from './http';
import { ValidationError } from './validation';

export enum HttpStatusCodes {
  Ok = 200,
  Created = 201,
  NoContent = 204,
  BadRequest = 400,
  Forbidden = 403,
  NotFound = 404,
  InternalServerError = 500,
}

/**
 * Construct a valid axios response that can be processed by the proxy handler
 */
export function axiosResponse<T>(
  status: number,
  data?: T,
  headers?: RawAxiosResponseHeaders | AxiosResponseHeaders,
  config?: AxiosRequestConfig,
): AxiosResponse<T, null> {
  return {
    overrideStatus: status,
    statusText: `${status}`,
    config: config ?? {},
    headers: headers ?? getOwnResponseHeaders(),
    data: data ?? ('' as unknown as T),
    status,
  } as AxiosResponse;
}

export function ok(resp: AxiosResponse): APIGatewayProxyResult {
  // handle redirects
  if (resp.status === 301 || resp.status === 302) {
    return {
      statusCode: resp.status,
      body: '',
      headers: {
        Location: resp.headers['location'] as string,
      },
    };
  }
  if (resp.status === HttpStatusCodes.NoContent) {
    return {
      statusCode: resp.status,
      body: '',
      headers: { ...passResponseHeaders(resp.headers) },
    };
  }

  let bodyProps;
  let isBase64Encoded;

  if (resp.data instanceof Buffer) {
    isBase64Encoded = Object.keys(resp.headers).some((h) => h.toLowerCase() === 'content-disposition');

    bodyProps = {
      body: resp.data.toString('base64'),
      headers: {
        ...passResponseHeaders(resp.headers),
        'content-transfer-encoding': 'base64',
      },
    };
  } else if (typeof resp.data == 'string') {
    // it's the case for /proctoredAssessment/{asrId}, which returns an HTML
    bodyProps = {
      body: resp.data,
      headers: passResponseHeaders(resp.headers),
    };
  } else {
    bodyProps = {
      body: JSON.stringify(resp.data),
      headers: passResponseHeaders(resp.headers),
    };
  }

  return {
    statusCode: (resp as any).overrideStatus ?? HttpStatusCodes.Ok,
    isBase64Encoded: isBase64Encoded,
    ...bodyProps,
  };
}

export function badRequest(error: ValidationError): APIGatewayProxyResult {
  return {
    statusCode: HttpStatusCodes.BadRequest,
    body: JSON.stringify({
      message: error.message,
      errorCode: 'API_VALIDATION',
    }),
    headers: getOwnResponseHeaders(),
  };
}

export function forbidden(error: AuthorizationError): APIGatewayProxyResult {
  return {
    statusCode: HttpStatusCodes.Forbidden,
    body: JSON.stringify({
      message: error.message,
      errorCode: 'API_AUTHORIZATION',
    }),
    headers: getOwnResponseHeaders(),
  };
}

export function internalServerError() {
  return {
    statusCode: HttpStatusCodes.InternalServerError,
    body: JSON.stringify({
      message: 'Internal error.',
      errorCode: 'API_INTERNAL',
    }),
  };
}
