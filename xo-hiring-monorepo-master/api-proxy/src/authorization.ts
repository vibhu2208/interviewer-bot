import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';
import { APIGatewayProxyEvent, APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import jp from 'jsonpath';
import { z } from 'zod';
import { logger } from './logger';
import { SalesforceRest } from './urls';
import {
  AppIdPathParameter,
  AsrIdPathParameter,
  IdPathParameter,
  ParameterType,
  SalesforceIdParameter,
} from './validation';

/**
 * Exception, which should be thrown on attempt to access other candidate data (will result in HTTP 403 Forbidden)
 */
export class AuthorizationError extends Error {
  constructor(public message: string) {
    super(message);
  }
}

export function toCaseInsensitiveId(id: string): string {
  if (id.length == 18) {
    return id;
  }
  if (id.length != 15) {
    throw new Error(`Unexpected id: ${id}`);
  }

  // converted from: https://help.salesforce.com/s/articleView?id=000385585&type=1

  const MID = (source: string, pos: number, length: number) => source.substring(pos - 1, pos - 1 + length);
  const FIND = (stringToSearchFor: string, stringToSearchAt: string) => stringToSearchAt.indexOf(stringToSearchFor) + 1;
  const IF = (condition: boolean, ifTrue: number, ifFalse: number) => (condition ? ifTrue : ifFalse);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const alphabetWithNumbers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

  return (
    id +
    MID(
      alphabetWithNumbers,
      IF(FIND(MID(id, 1, 1), alphabet) > 0, 1, 0) +
        IF(FIND(MID(id, 2, 1), alphabet) > 0, 2, 0) +
        IF(FIND(MID(id, 3, 1), alphabet) > 0, 4, 0) +
        IF(FIND(MID(id, 4, 1), alphabet) > 0, 8, 0) +
        IF(FIND(MID(id, 5, 1), alphabet) > 0, 16, 0) +
        1,
      1,
    ) +
    MID(
      alphabetWithNumbers,
      IF(FIND(MID(id, 6, 1), alphabet) > 0, 1, 0) +
        IF(FIND(MID(id, 7, 1), alphabet) > 0, 2, 0) +
        IF(FIND(MID(id, 8, 1), alphabet) > 0, 4, 0) +
        IF(FIND(MID(id, 9, 1), alphabet) > 0, 8, 0) +
        IF(FIND(MID(id, 10, 1), alphabet) > 0, 16, 0) +
        1,
      1,
    ) +
    MID(
      alphabetWithNumbers,
      IF(FIND(MID(id, 11, 1), alphabet) > 0, 1, 0) +
        IF(FIND(MID(id, 12, 1), alphabet) > 0, 2, 0) +
        IF(FIND(MID(id, 13, 1), alphabet) > 0, 4, 0) +
        IF(FIND(MID(id, 14, 1), alphabet) > 0, 8, 0) +
        IF(FIND(MID(id, 15, 1), alphabet) > 0, 16, 0) +
        1,
      1,
    )
  );
}

export function salesforceIdsEqual(left: string, right: string) {
  if (left.length == 15 && right.length == 15) {
    return left === right;
  }
  return toCaseInsensitiveId(left).toLowerCase() === toCaseInsensitiveId(right).toLowerCase();
}

export async function checkCandidateId(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  candidateId: SalesforceIdParameter,
) {
  const { username } = event.requestContext.authorizer.claims as { username?: string };

  if (!username || !salesforceIdsEqual(username, candidateId.toString())) {
    throw newAccessDeniedError();
  }
}

/**
 * Check that candidate in path is the same 'username' claim in token.
 */
export const authorizeCandidate = (e: APIGatewayProxyWithCognitoAuthorizerEvent) =>
  checkCandidateId(e, new IdPathParameter(e));

export async function checkObjectOwnership(
  objectName: string,
  objectId: SalesforceIdParameter,
  candidateIdPropertyName: string,
  candidateId: SalesforceIdParameter,
) {
  const client = await getSalesforceClient();
  const resp = await client.get(SalesforceRest.query, {
    params: {
      q: `SELECT Id FROM ${objectName} WHERE Id='${objectId}' AND ${candidateIdPropertyName}='${candidateId}'`,
    },
  });

  if (!resp.data.totalSize) {
    throw newAccessDeniedError();
  }
}

export async function checkApplicationOwnership(candidateId: SalesforceIdParameter, appId: SalesforceIdParameter) {
  return checkObjectOwnership('Opportunity', appId, 'AccountId', candidateId);
}

/**
 * Check that application, identified by id in path, is owned by the requesting user.
 */
export const authorizeApplicationOwner = (e: APIGatewayProxyWithCognitoAuthorizerEvent) =>
  checkApplicationOwnership(new IdPathParameter(e), new AppIdPathParameter(e));

export async function checkApplicationStepResultOwnership(
  candidateId: SalesforceIdParameter,
  asrId: SalesforceIdParameter,
) {
  return checkObjectOwnership('Application_Step_Result__c', asrId, 'Candidate__c', candidateId);
}

/**
 * Check that application step result, identified by id in path, is owned by the requesting user.
 */
export const authorizeApplicationStepResultOwner = (e: APIGatewayProxyWithCognitoAuthorizerEvent) =>
  checkApplicationStepResultOwnership(new IdPathParameter(e), new AsrIdPathParameter(e));

export async function checkCandidateInformationOwnership(
  candidateId: SalesforceIdParameter,
  infoId: SalesforceIdParameter,
) {
  return checkObjectOwnership('Candidate_Information__c', infoId, 'Candidate__c', candidateId);
}

/**
 * Check that candidate information, identified by id in path, is owned by the requesting user.
 */
export const authorizeCandidateInformationOwner = (e: APIGatewayProxyWithCognitoAuthorizerEvent) =>
  checkCandidateInformationOwnership(
    new IdPathParameter(e),
    new SalesforceIdParameter(e, 'infoid', ParameterType.Path),
  );

async function checkCandidateIdMatch(
  data: unknown,
  candidateIdsPath: string,
  candidateId: SalesforceIdParameter,
  allowIfNoMatch?: boolean,
) {
  const resultCandidateIds = jp.query(data, candidateIdsPath) as unknown[];
  if (resultCandidateIds.length == 0 && !allowIfNoMatch) {
    logger.warn(`Candidate id '${candidateId}' check failed. No match of candidate id in payload.`);
    throw newAccessDeniedError();
  }

  for (const resultCandidateId of resultCandidateIds) {
    if (typeof resultCandidateId != 'string' || !salesforceIdsEqual(resultCandidateId, candidateId.toString())) {
      logger.warn(`Candidate id '${candidateId}' check failed. Selected value: '${resultCandidateId}'`);
      throw newAccessDeniedError();
    }
  }
}

export async function checkEventCandidateMatch(
  candidateId: SalesforceIdParameter,
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  candidateIdsPath: string,
  allowIfNoMatch?: boolean,
) {
  return checkCandidateIdMatch(
    event.body == null ? {} : (JSON.parse(event.body) as unknown),
    candidateIdsPath,
    candidateId,
    allowIfNoMatch,
  );
}

export async function checkResponseCandidateMatch(
  candidateId: SalesforceIdParameter,
  response: AxiosResponse<unknown, unknown>,
  candidateIdsPath: string,
  allowIfNoMatch?: boolean,
) {
  return checkCandidateIdMatch(response.data, candidateIdsPath, candidateId, allowIfNoMatch);
}

export async function checkEventPayloadFields(event: APIGatewayProxyEvent, dataContract: z.ZodType) {
  const parseResult = dataContract.safeParse(JSON.parse(event.body as string) as unknown);
  if (!parseResult.success) {
    logger.warn(`Event payload check failure: ${parseResult.error}`);

    // In case of extra fields: "Unrecognized key(s) in object: 'X', 'Y'"
    throw newAccessDeniedError(parseResult.error.issues[0].message);
  }
}

function newAccessDeniedError(message?: string) {
  return new AuthorizationError(message || `Access denied.`);
}

// denyAll is used to deny access for all candidates, leaving the resources accessible for staff
export const denyAll = () => {
  throw newAccessDeniedError();
};
