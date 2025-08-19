import { Context } from '@aws-appsync/utils';

const SessionProtectedFields = ['grading', 'sessionEvents'];
const QuestionProtectedFields = [
  'perfectAnswer',
  'correctnessGrading',
  'depthGrading',
  'promptResult',
  'gradingRubric',
  'cheatingRubric',
  'cheatingCheck',
  'cheatingPatterns',
  'cheatingCheckRegex',
  'gradingRules',
  'dimensions',
  'dimensionsGrading',
];
const InjectedFieldName = '__dp_provided_secret_key';
const SecretKeyHeaderName = 'ib-secret-key';

/**
 * Remove specific fields from the object. Returns a copy, does not modify the original object
 * @param obj any js object
 * @param fields array of field names
 */
export function redactFields(obj: any, fields: string[]): any {
  const copy = { ...obj };
  fields.forEach((it) => delete copy[it]);
  return copy;
}

/**
 * Remove protected Session fields
 */
export function protectSession(ctx: Context, obj: any): any {
  let returnObj = obj;
  if (!ctx.stash.authenticated) {
    returnObj = redactFields(obj, SessionProtectedFields);
  }
  // We inject provided secret key into the output object to pass it to children resolvers
  // It will not be returned to the requester as it is not part of the schema
  returnObj[InjectedFieldName] = getProvidedSecretKey(ctx);

  return returnObj;
}

/**
 * Remove protected Questions fields
 */
export function protectQuestions(ctx: Context, objs: any[]): any {
  if (!ctx.stash.authenticated) {
    return objs.map((it) => redactFields(it, QuestionProtectedFields));
  }
  return objs;
}

/**
 * Extract provided secret key from the arguments, header, or internal field
 * @param ctx
 */
function getProvidedSecretKey(ctx: Context): string | null {
  return ctx.args?.secretKey ?? ctx.request?.headers?.[SecretKeyHeaderName] ?? ctx.source?.[InjectedFieldName];
}

/**
 * Check that secret key is provided. We either expect if in args, or in a header
 * Sets ctx.stash.authenticated to a boolean
 *
 * @param ctx gql context
 * @param validSecretKey the valid secret key that we are comparing with
 */
export function checkAuthentication(ctx: Context, validSecretKey: string | null) {
  const providedKey = getProvidedSecretKey(ctx);
  ctx.stash.authenticated = providedKey != null && providedKey === validSecretKey;
}
