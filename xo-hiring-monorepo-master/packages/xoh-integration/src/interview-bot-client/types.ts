/**
 * Represents an interview conversation.
 */
export interface InterviewConversation {
  /**
   * The ID of the session.
   */
  sessionId: string;
  /**
   * The ID of the question.
   */
  questionId: string;
  /**
   * An array of conversation entries, each with a role and content.
   */
  conversation: Array<{
    /**
     * The role of the speaker (e.g., 'Candidate', 'Interviewer').
     */
    role: 'Candidate' | 'Interviewer' | string;
    /**
     * The content of the speaker's message.
     */
    content: string;
  }>;
}

export interface FetchInterviewConversationsRequest {
  sessionIds: string[];
}

export interface FetchInterviewConversationsResponse {
  interviewConversations: InterviewConversation[];
}
