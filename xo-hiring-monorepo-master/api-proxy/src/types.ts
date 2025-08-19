import { APIGatewayProxyEvent, APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { AxiosResponse } from 'axios';

export type Resources = Record<string, Resource | undefined>;

export type Resource = {
  [K in HttpMethod]?: Endpoint;
};
export type HttpMethod = 'unknown' | 'get' | 'head' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Endpoints, which do not require Cognito authorizer.
 */
export type PublicEndpoint = Handler;

/**
 * Endpoints, which require Cognito authorizer to be present.
 */
export type PrivateEndpoint = {
  /**
   * Handlers, which perform early-stage authorization checks, based on the incoming events.
   */
  eventAuthorizer?: EventAuthorizationHandlers;
  /**
   * Main endpoint handler, takes incoming event, performs integration requests and returns the last response.
   */
  handler: Handler;
  /**
   * Handlers, which perform late-stage authorization checks, based on the last integration response.
   * Helpful in case, when you want to join authorization check and the main query.
   */
  responseAuthorizer?: ResponseAuthorizationHandlers;
};

export type Endpoint = PublicEndpoint | PrivateEndpoint;

export type Handler = (event: APIGatewayProxyEvent, context: Context) => Promise<AxiosResponse<unknown, unknown>>;

export type EventAuthorizationHandlers = EventAuthorizationHandler | EventAuthorizationHandler[];

export type EventAuthorizationHandler = (event: APIGatewayProxyWithCognitoAuthorizerEvent) => Promise<void>;

export type ResponseAuthorizationHandlers = ResponseAuthorizationHandler | ResponseAuthorizationHandler[];

export type ResponseAuthorizationHandler = (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  response: AxiosResponse<unknown, unknown>,
) => Promise<void>;
