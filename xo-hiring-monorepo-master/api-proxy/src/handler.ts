import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayProxyWithCognitoAuthorizerEvent,
  Context,
} from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { z } from 'zod';
import { AuthorizationError } from './authorization';
import { importantFromAxiosError, logger, valuableRequestFields } from './logger';
import resources from './resources';
import { badRequest, forbidden, internalServerError, ok } from './responses';
import { EventAuthorizationHandlers, HttpMethod, ResponseAuthorizationHandlers } from './types';
import { ValidationError } from './validation';

export async function handler(
  event: APIGatewayProxyWithCognitoAuthorizerEvent | APIGatewayProxyEvent,
  context: Context,
) {
  logger.resetKeys();
  logger.addContext(context);

  // Additional information if the user is authorized
  const candidateId = event.requestContext?.authorizer?.claims?.['username'];
  if (candidateId != null) {
    logger.appendKeys({ candidateId });
  }
  const email = event.requestContext?.authorizer?.claims?.['email'];
  if (email != null) {
    logger.appendKeys({ email });
  }

  const sessionId = event.headers?.['x-session-id'];
  if (sessionId != null) {
    try {
      const validSessionId = z.string().uuid().parse(sessionId);
      logger.appendKeys({ sessionId: validSessionId });
    } catch (error) {
      logger.warn(`Invalid session ID format: ${sessionId}`);
    }
  }

  // Add request URL as a part of the context
  logger.appendKeys({
    requestUrl: event.path,
  });

  // Always log the event (as we used to do)
  logger.logEventIfEnabled(event, true);

  event.body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : null;
  event.isBase64Encoded = false;

  let result: APIGatewayProxyResult;
  try {
    const resource = resources[event.resource];
    if (!resource) {
      throw new Error(`Resource not found: ${event.resource}`);
    }

    const method = toHttpMethod(event.httpMethod);

    const endpoint = resource[method];
    if (!endpoint) {
      throw new Error(`Method not found: ${method}`);
    }

    const simpleEndpoint = typeof endpoint == 'function';

    let response: AxiosResponse<unknown, unknown> | undefined = undefined;
    if (simpleEndpoint) {
      // no authorization checks
      response = await endpoint(event, context);
      logger.info(`Response`, {
        response,
      });
    } else {
      if (!isCognitoContext(event)) {
        throw new Error('No Cognito authorizer for protected endpoint.');
      }

      const staffAccessGranted = isStaffAccessGranted(event);

      // event authorization
      if (endpoint.eventAuthorizer && !staffAccessGranted) {
        await authorizeEvent(event, endpoint.eventAuthorizer);
      }

      // target request
      response = await endpoint.handler(event, context);

      // late-stage authorization
      if (endpoint.responseAuthorizer && !staffAccessGranted) {
        await authorizeResponse(event, response, endpoint.responseAuthorizer);
      }
    }

    result = ok(response);
    logger.info(`Response`, {
      response: result,
    });
  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      result = badRequest(error);
    } else if (error instanceof AuthorizationError) {
      result = forbidden(error);
    } else {
      result = internalServerError();
    }
    logger.error(`Error while processing request`, {
      request: valuableRequestFields(event),
      response: result,
      error: importantFromAxiosError(error),
    });
  } finally {
    logger.resetKeys();
  }

  return result;
}

async function authorizeEvent(event: APIGatewayProxyWithCognitoAuthorizerEvent, handlers: EventAuthorizationHandlers) {
  const handlersList = typeof handlers == 'function' ? [handlers] : handlers;
  for (const handler of handlersList) {
    await handler(event);
  }
}

async function authorizeResponse(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  response: AxiosResponse<unknown, unknown>,
  handlers: ResponseAuthorizationHandlers,
) {
  const handlersList = typeof handlers == 'function' ? [handlers] : handlers;
  for (const handler of handlersList) {
    await handler(event, response);
  }
}

const getStaffGroupNames = () =>
  z
    .object({
      READONLY_GROUP_NAMES: z.string(),
      FULLACCESS_GROUP_NAMES: z.string(),
    })
    .transform((o) => ({
      readonlyGroupNames: o.READONLY_GROUP_NAMES.split(','),
      fullAccessGroupNames: o.FULLACCESS_GROUP_NAMES.split(','),
    }))
    .parse(process.env);

function isStaffAccessGranted(event: APIGatewayProxyWithCognitoAuthorizerEvent) {
  const groups = event.requestContext.authorizer.claims['cognito:groups']?.split(',') || [];

  if (groups.length == 0) {
    return false;
  }

  const staffGroupNames = getStaffGroupNames();

  const fullAccessGranted = groups.filter((g) => staffGroupNames.fullAccessGroupNames.includes(g)).length > 0;
  if (fullAccessGranted) {
    event.requestContext.authorizer.claims['elevatedAccess'] = `full`;
    logger.info(`Staff full access granted.`);
    logger.appendKeys({
      elevatedAccess: 'full',
    });
    return true;
  }

  const readonlyAccessGranted = groups.filter((g) => staffGroupNames.readonlyGroupNames.includes(g)).length > 0;
  if (toHttpMethod(event.httpMethod) == 'get' && readonlyAccessGranted) {
    event.requestContext.authorizer.claims['elevatedAccess'] = `read`;
    logger.info(`Staff read-only access granted.`);
    logger.appendKeys({
      elevatedAccess: 'read',
    });
    return true;
  }

  return false;
}

function toHttpMethod(text: string): HttpMethod {
  const lowerCaseText = text.toLowerCase();
  switch (lowerCaseText) {
    case 'get':
    case 'post':
    case 'put':
    case 'patch':
    case 'delete':
      return lowerCaseText;
    case 'head':
      return 'get';
    default:
      return 'unknown';
  }
}

function isCognitoContext(
  event: APIGatewayProxyWithCognitoAuthorizerEvent | APIGatewayProxyEvent,
): event is APIGatewayProxyWithCognitoAuthorizerEvent {
  return event.requestContext.authorizer?.claims !== undefined;
}
