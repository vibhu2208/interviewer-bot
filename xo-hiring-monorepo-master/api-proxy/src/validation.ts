import { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Exception, which should be thrown for bad user input (will result in HTTP 400 BadRequest)
 */
export class ValidationError extends Error {
  constructor(public message: string) {
    super(message);
  }
}

export enum ParameterType {
  Path,
  QueryString,
}

const parameterTypeDisplayName: Record<ParameterType, string> = {
  [ParameterType.Path]: 'Path',
  [ParameterType.QueryString]: 'Query string',
};

function displayParameter(name: string, parameterType: ParameterType) {
  return `${parameterTypeDisplayName[parameterType]} parameter '${name}'`;
}

function getParameter(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType) {
  return (parameterType == ParameterType.Path ? event.pathParameters : event.queryStringParameters)?.[name];
}

export function parameterExists(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType) {
  return getParameter(event, name, parameterType) !== undefined;
}

export function requireParameter(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType) {
  // checking the value is provided
  const value = getParameter(event, name, parameterType);
  if (!value) {
    throw new ValidationError(`${displayParameter(name, parameterType)} is not provided.`);
  }
  return value;
}

/**
 * Represents a string, which was not validated properly, so to protect against
 * dangerous syntax, the value should be escaped before usage
 */
export class UnsafeParameterForSoql {
  constructor(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType) {
    this.unsafeValue = requireParameter(event, name, parameterType);
  }

  private unsafeValue: string;

  toString() {
    // Reserved Characters
    // https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_reservedcharacters.htm
    return this.unsafeValue.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}

/**
 * Represents an API parameter, which was validated against a known, strict enough format
 */
export class SafeParameter {
  constructor(
    event: APIGatewayProxyEvent,
    name: string,
    parameterType: ParameterType,
    validation: RegExp | ((value: string) => boolean),
  ) {
    const value = requireParameter(event, name, parameterType);

    const test = typeof validation == 'function' ? validation : validation.test.bind(validation);

    if (!test(value)) {
      throw new ValidationError(`${displayParameter(name, parameterType)} is not valid.`);
    }
    this.value = value;
  }

  toString() {
    return this.value;
  }

  value: string;
}

export class SwitchParameter extends SafeParameter {
  constructor(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType, options: string[]) {
    super(event, name, parameterType, options.includes.bind(options));
  }
}

export class AnyParameter extends SafeParameter {
  constructor(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType) {
    super(event, name, parameterType, () => true);
  }
}

export class SalesforceIdParameter extends SafeParameter {
  constructor(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType) {
    super(event, name, parameterType, /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/);
  }
}

export class SalesforceIdListParameter extends SafeParameter {
  constructor(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType) {
    super(event, name, parameterType, /^([a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?)(,[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?)*$/);
  }
}

export class SalesforceProductCodeParameter extends SafeParameter {
  constructor(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType) {
    super(event, name, parameterType, /^\d{3,4}$/);
  }
}

export class SalesforceObjectTypeParameter extends SafeParameter {
  constructor(event: APIGatewayProxyEvent, name: string, parameterType: ParameterType) {
    super(event, name, parameterType, /^\w{1,43}$/);
  }
}

export class IdPathParameter extends SalesforceIdParameter {
  constructor(event: APIGatewayProxyEvent) {
    super(event, 'id', ParameterType.Path);
  }
}

export class AppIdPathParameter extends SalesforceIdParameter {
  constructor(event: APIGatewayProxyEvent) {
    super(event, 'appId', ParameterType.Path);
  }
}

export class AsrIdPathParameter extends SalesforceIdParameter {
  constructor(event: APIGatewayProxyEvent) {
    super(event, 'asrId', ParameterType.Path);
  }
}
