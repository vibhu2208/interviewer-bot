import { CloudFrontHeaders, CloudFrontResponseEvent } from 'aws-lambda';

function setHeader(headers: CloudFrontHeaders, name: string, value: string) {
  headers[name] = [{ key: name, value }];
}

/**
 * This function adds CORS-related headers on the Salesforce cometd response,
 * so that we can consume its APIs from anywhere
 */
export async function handler(event: CloudFrontResponseEvent) {
  // Decode event
  const response = event.Records[0].cf.response;
  const request = event.Records[0].cf.request;

  // Modify response
  if (request.headers.origin) {
    const responseHeaders = response.headers;
    setHeader(responseHeaders, 'Access-Control-Allow-Origin', request.headers.origin[0].value);
    setHeader(
      responseHeaders,
      'Access-Control-Allow-Headers',
      'append,delete,entries,foreach,get,has,keys,set,values,Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,pragma',
    );
    setHeader(responseHeaders, 'Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    setHeader(responseHeaders, 'Access-Control-Allow-Credentials', 'true');
  }

  return response;
}
