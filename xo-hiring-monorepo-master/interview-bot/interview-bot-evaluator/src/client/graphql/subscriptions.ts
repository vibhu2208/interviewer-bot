/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from './api';
type GeneratedSubscription<InputType, OutputType> = string & {
  __generatedSubscriptionInput: InputType;
  __generatedSubscriptionOutput: OutputType;
};

export const answerAttempted = /* GraphQL */ `subscription AnswerAttempted($sessionId: ID!, $questionId: ID!) {
  answerAttempted(sessionId: $sessionId, questionId: $questionId) {
    error
    result
    attempts
    sessionId
    questionId
    state
    validAnswer
    __typename
  }
}
` as GeneratedSubscription<APITypes.AnswerAttemptedSubscriptionVariables, APITypes.AnswerAttemptedSubscription>;
