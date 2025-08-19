import { APIGatewayProxyResult } from 'aws-lambda';

export function errorResponse(statusCode: number, message: string): APIGatewayProxyResult {
  return createResponse(statusCode, { message });
}

export function successResponse(body: any): APIGatewayProxyResult {
  return createResponse(200, body);
}

export function createResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  };
}
