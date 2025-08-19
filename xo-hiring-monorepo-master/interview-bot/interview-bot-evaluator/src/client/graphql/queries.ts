/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from './api';
type GeneratedQuery<InputType, OutputType> = string & {
  __generatedQueryInput: InputType;
  __generatedQueryOutput: OutputType;
};

export const getSessionById = /* GraphQL */ `query GetSessionById($sessionId: ID!, $secretKey: String) {
  getSessionById(sessionId: $sessionId, secretKey: $secretKey) {
    id
    state
    durationLimit
    isTimeboxed
    startTime
    endTime
    grading {
      summary
      score
      __typename
    }
    sessionEvents {
      time
      type
      __typename
    }
    skill {
      id
      name
      description
      instructions
      mode
      detectTabSwitches
      preventCopyPaste
      __typename
    }
    questions {
      id
      question
      perfectAnswer
      answer
      correctnessGrading {
        summary
        score
        __typename
      }
      depthGrading {
        summary
        score
        __typename
      }
      defaultAnswer
      promptSettings {
        maxAttempts
        model
        __typename
      }
      promptResult
      answerMaxSize
      answerAttempts
      gradingRubric
      cheatingRubric
      cheatingCheck {
        summary
        cheated
        __typename
      }
      cheatingPatterns
      cheatingCheckRegex {
        summary
        cheated
        __typename
      }
      gradingRules {
        description
        score
        __typename
      }
      status
      conversation {
        content
        role
        __typename
      }
      state
      dimensions {
        name
        levels
        __typename
      }
      dimensionsGrading {
        name
        level
        summary
        __typename
      }
      __typename
    }
    testTaker {
      name
      email
      __typename
    }
    __typename
  }
}
` as GeneratedQuery<APITypes.GetSessionByIdQueryVariables, APITypes.GetSessionByIdQuery>;
