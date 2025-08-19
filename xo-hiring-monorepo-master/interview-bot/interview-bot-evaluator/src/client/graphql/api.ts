/* tslint:disable */
/* eslint-disable */
//  This file was automatically generated and should not be edited.

export type OperationResult = {
  __typename: 'OperationResult';
  error?: string | null;
};

export enum Perception {
  Good = 'Good',
  Neutral = 'Neutral',
  Bad = 'Bad',
}

export type AnswerAttemptInput = {
  error?: string | null;
  // Null if success
  result?: string | null;
  attempts?: number | null;
  sessionId?: string | null;
  // This field must be provided by lambda to allow filtering
  questionId?: string | null;
  // This field must be provided by lambda to allow filtering
  state?: string | null;
  // Question state (if the question have one). One of: 'Completed' | null
  validAnswer?: boolean | null;
};

export type AnswerAttemptResult = {
  __typename: 'AnswerAttemptResult';
  error?: string | null;
  // Null if success
  result?: string | null;
  attempts?: number | null;
  sessionId?: string | null;
  // This field must be requested as output by lambda to allow filtering
  questionId?: string | null;
  // This field must be requested as output by lambda to allow filtering
  state?: string | null;
  // Question state (if the question have one). One of: 'Completed' | null
  validAnswer?: boolean | null;
};

export type Session = {
  __typename: 'Session';
  id: string;
  state: SessionState;
  durationLimit: number;
  isTimeboxed: boolean;
  startTime?: string | null;
  endTime?: string | null;
  grading?: Grading | null;
  // Protected
  sessionEvents?: Array<SessionEvent | null> | null;
  // Protected
  skill: Skill;
  questions: Array<Question | null>;
  // Resolver
  testTaker: UserInfo;
};

export enum SessionState {
  Initializing = 'Initializing',
  Ready = 'Ready',
  Started = 'Started',
  Completed = 'Completed',
  Graded = 'Graded',
}

export type Grading = {
  __typename: 'Grading';
  summary?: string | null;
  score?: number | null;
};

export type SessionEvent = {
  __typename: 'SessionEvent';
  time: string;
  type: string;
};

export type Skill = {
  __typename: 'Skill';
  id: string;
  name: string;
  description: string;
  instructions?: string | null;
  mode?: string | null;
  // 'free-response' | 'prompt-engineering' | 'interview'
  detectTabSwitches?: boolean | null;
  preventCopyPaste?: boolean | null;
};

export type Question = {
  __typename: 'Question';
  id: string;
  question: string;
  perfectAnswer?: string | null;
  // Protected
  answer?: string | null;
  correctnessGrading?: Grading | null;
  // Protected
  depthGrading?: Grading | null;
  // Protected
  defaultAnswer?: string | null;
  promptSettings?: QuestionConfiguration | null;
  promptResult?: string | null;
  // Protected
  answerMaxSize?: number | null;
  answerAttempts?: number | null;
  gradingRubric?: string | null;
  // Protected
  cheatingRubric?: string | null;
  // Protected
  cheatingCheck?: CheatingCheck | null;
  // Protected
  cheatingPatterns?: Array<string | null> | null;
  // Protected
  cheatingCheckRegex?: CheatingCheck | null;
  // Protected
  gradingRules?: Array<GradingRule | null> | null;
  // Protected
  status?: string | null;
  conversation?: Array<ConversationElement | null> | null;
  state?: string | null;
  // 'Completed' if the question if completed
  dimensions?: Array<Dimension | null> | null;
  // Protected
  dimensionsGrading?: Array<DimensionGrading | null> | null;
};

export type QuestionConfiguration = {
  __typename: 'QuestionConfiguration';
  maxAttempts?: number | null;
  model?: string | null;
};

export type CheatingCheck = {
  __typename: 'CheatingCheck';
  summary?: string | null;
  cheated?: string | null;
};

export type GradingRule = {
  __typename: 'GradingRule';
  description?: string | null;
  score?: number | null;
};

export type ConversationElement = {
  __typename: 'ConversationElement';
  content?: string | null;
  role?: string | null;
};

export type Dimension = {
  __typename: 'Dimension';
  name?: string | null;
  levels?: number | null;
};

export type DimensionGrading = {
  __typename: 'DimensionGrading';
  name?: string | null;
  level?: number | null;
  summary?: string | null;
};

export type UserInfo = {
  __typename: 'UserInfo';
  name: string;
  email: string;
};

export type SetQuestionAnswerMutationVariables = {
  sessionId: string;
  questionId: string;
  answer: string;
};

export type SetQuestionAnswerMutation = {
  setQuestionAnswer?: boolean | null;
};

export type MarkSessionAsCompletedMutationVariables = {
  sessionId: string;
};

export type MarkSessionAsCompletedMutation = {
  markSessionAsCompleted?: boolean | null;
};

export type AttemptAnswerMutationVariables = {
  sessionId: string;
  questionId: string;
  answer: string;
};

export type AttemptAnswerMutation = {
  attemptAnswer: {
    __typename: 'OperationResult';
    error?: string | null;
  };
};

export type RecordFeedbackMutationVariables = {
  sessionId: string;
  perception: Perception;
  comment?: string | null;
};

export type RecordFeedbackMutation = {
  recordFeedback?: boolean | null;
};

export type RecordSessionEventMutationVariables = {
  sessionId: string;
  eventName: string;
};

export type RecordSessionEventMutation = {
  recordSessionEvent?: boolean | null;
};

export type TriggerAnswerAttemptedMutationVariables = {
  data: AnswerAttemptInput;
};

export type TriggerAnswerAttemptedMutation = {
  // Used internally to trigger subscription. Only lambda can call it due to @aws_iam
  // The input will be echoed back as the response as required by the subscription mechanism
  triggerAnswerAttempted: {
    __typename: 'AnswerAttemptResult';
    error?: string | null;
    // Null if success
    result?: string | null;
    attempts?: number | null;
    sessionId?: string | null;
    // This field must be requested as output by lambda to allow filtering
    questionId?: string | null;
    // This field must be requested as output by lambda to allow filtering
    state?: string | null;
    // Question state (if the question have one). One of: 'Completed' | null
    validAnswer?: boolean | null;
  };
};

export type GetSessionByIdQueryVariables = {
  sessionId: string;
  secretKey?: string | null;
};

export type GetSessionByIdQuery = {
  getSessionById?: {
    __typename: 'Session';
    id: string;
    state: SessionState;
    durationLimit: number;
    isTimeboxed: boolean;
    startTime?: string | null;
    endTime?: string | null;
    grading?: {
      __typename: 'Grading';
      summary?: string | null;
      score?: number | null;
    } | null;
    // Protected
    sessionEvents?: Array<{
      __typename: 'SessionEvent';
      time: string;
      type: string;
    } | null> | null;
    // Protected
    skill: {
      __typename: 'Skill';
      id: string;
      name: string;
      description: string;
      instructions?: string | null;
      mode?: string | null;
      // 'free-response' | 'prompt-engineering' | 'interview'
      detectTabSwitches?: boolean | null;
      preventCopyPaste?: boolean | null;
    };
    questions: Array<{
      __typename: 'Question';
      id: string;
      question: string;
      perfectAnswer?: string | null;
      // Protected
      answer?: string | null;
      correctnessGrading?: {
        __typename: 'Grading';
        summary?: string | null;
        score?: number | null;
      } | null;
      // Protected
      depthGrading?: {
        __typename: 'Grading';
        summary?: string | null;
        score?: number | null;
      } | null;
      // Protected
      defaultAnswer?: string | null;
      promptSettings?: {
        __typename: 'QuestionConfiguration';
        maxAttempts?: number | null;
        model?: string | null;
      } | null;
      promptResult?: string | null;
      // Protected
      answerMaxSize?: number | null;
      answerAttempts?: number | null;
      gradingRubric?: string | null;
      // Protected
      cheatingRubric?: string | null;
      // Protected
      cheatingCheck?: {
        __typename: 'CheatingCheck';
        summary?: string | null;
        cheated?: string | null;
      } | null;
      // Protected
      cheatingPatterns?: Array<string | null> | null;
      // Protected
      cheatingCheckRegex?: {
        __typename: 'CheatingCheck';
        summary?: string | null;
        cheated?: string | null;
      } | null;
      // Protected
      gradingRules?: Array<{
        __typename: 'GradingRule';
        description?: string | null;
        score?: number | null;
      } | null> | null;
      // Protected
      status?: string | null;
      conversation?: Array<{
        __typename: 'ConversationElement';
        content?: string | null;
        role?: string | null;
      } | null> | null;
      state?: string | null;
      // 'Completed' if the question if completed
      dimensions?: Array<{
        __typename: 'Dimension';
        name?: string | null;
        levels?: number | null;
      } | null> | null;
      // Protected
      dimensionsGrading?: Array<{
        __typename: 'DimensionGrading';
        name?: string | null;
        level?: number | null;
        summary?: string | null;
      } | null> | null;
    } | null>;
    // Resolver
    testTaker: {
      __typename: 'UserInfo';
      name: string;
      email: string;
    };
  } | null;
};

export type AnswerAttemptedSubscriptionVariables = {
  sessionId: string;
  questionId: string;
};

export type AnswerAttemptedSubscription = {
  // Subscribe to the answer attempt result for the specific question. The output should be nullable
  // sessionId and questionId are filtering based on the content of the AnswerAttemptResult (field names must match)
  answerAttempted?: {
    __typename: 'AnswerAttemptResult';
    error?: string | null;
    // Null if success
    result?: string | null;
    attempts?: number | null;
    sessionId?: string | null;
    // This field must be requested as output by lambda to allow filtering
    questionId?: string | null;
    // This field must be requested as output by lambda to allow filtering
    state?: string | null;
    // Question state (if the question have one). One of: 'Completed' | null
    validAnswer?: boolean | null;
  } | null;
};
