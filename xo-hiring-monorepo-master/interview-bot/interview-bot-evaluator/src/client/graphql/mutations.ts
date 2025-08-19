/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from './api';
type GeneratedMutation<InputType, OutputType> = string & {
  __generatedMutationInput: InputType;
  __generatedMutationOutput: OutputType;
};

export const setQuestionAnswer = /* GraphQL */ `mutation SetQuestionAnswer(
  $sessionId: ID!
  $questionId: ID!
  $answer: String!
) {
  setQuestionAnswer(
    sessionId: $sessionId
    questionId: $questionId
    answer: $answer
  )
}
` as GeneratedMutation<APITypes.SetQuestionAnswerMutationVariables, APITypes.SetQuestionAnswerMutation>;
export const markSessionAsCompleted = /* GraphQL */ `mutation MarkSessionAsCompleted($sessionId: ID!) {
  markSessionAsCompleted(sessionId: $sessionId)
}
` as GeneratedMutation<APITypes.MarkSessionAsCompletedMutationVariables, APITypes.MarkSessionAsCompletedMutation>;
export const attemptAnswer =
  /* GraphQL */ `mutation AttemptAnswer($sessionId: ID!, $questionId: ID!, $answer: String!) {
  attemptAnswer(
    sessionId: $sessionId
    questionId: $questionId
    answer: $answer
  ) {
    error
    __typename
  }
}
` as GeneratedMutation<APITypes.AttemptAnswerMutationVariables, APITypes.AttemptAnswerMutation>;
export const recordFeedback = /* GraphQL */ `mutation RecordFeedback(
  $sessionId: ID!
  $perception: Perception!
  $comment: String
) {
  recordFeedback(
    sessionId: $sessionId
    perception: $perception
    comment: $comment
  )
}
` as GeneratedMutation<APITypes.RecordFeedbackMutationVariables, APITypes.RecordFeedbackMutation>;
export const recordSessionEvent = /* GraphQL */ `mutation RecordSessionEvent($sessionId: ID!, $eventName: String!) {
  recordSessionEvent(sessionId: $sessionId, eventName: $eventName)
}
` as GeneratedMutation<APITypes.RecordSessionEventMutationVariables, APITypes.RecordSessionEventMutation>;
export const triggerAnswerAttempted = /* GraphQL */ `mutation TriggerAnswerAttempted($data: AnswerAttemptInput!) {
  triggerAnswerAttempted(data: $data) {
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
` as GeneratedMutation<APITypes.TriggerAnswerAttemptedMutationVariables, APITypes.TriggerAnswerAttemptedMutation>;
