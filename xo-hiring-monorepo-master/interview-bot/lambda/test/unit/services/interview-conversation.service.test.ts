import { SessionContext } from '../../../src/common/session-context';
import { fetchInterviewConversations } from '../../../src/services/interview-conversation.service';
import { InterviewConversation } from '../../../src/model/interview-conversation.models';
import { SessionContextData } from '../../../src/common/session-context';
import { SkillDocument } from '../../../src/model/skill';
import { EnrichedQuestionDocument } from '../../../src/common/session-context';
import { SessionDocument } from '../../../src/model/session';

// Mocks
jest.mock('../../../src/common/session-context');

const mockedSessionContext = SessionContext as jest.Mocked<typeof SessionContext>;

describe('fetchInterviewConversations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an empty array if no session IDs are provided', async () => {
    const result = await fetchInterviewConversations([]);
    expect(result).toEqual([]);
    expect(mockedSessionContext.fetch).not.toHaveBeenCalled();
  });

  it('should fetch session contexts and filter out non-interview skills', async () => {
    const sessionIds = ['session1', 'session2'];
    const context1: Partial<SessionContextData> = {
      session: { id: 'session1' } as SessionDocument,
      skill: { mode: 'interview', name: 'Interview Skill' } as SkillDocument,
      questions: [],
    };
    const context2: Partial<SessionContextData> = {
      session: { id: 'session2' } as SessionDocument,
      skill: { mode: 'free-response', name: 'Quiz Skill' } as SkillDocument,
      questions: [],
    };

    mockedSessionContext.fetch.mockResolvedValueOnce(context1 as SessionContextData);
    mockedSessionContext.fetch.mockResolvedValueOnce(context2 as SessionContextData);

    const result = await fetchInterviewConversations(sessionIds);
    expect(result).toEqual([]);
    expect(mockedSessionContext.fetch).toHaveBeenCalledWith('session1', true);
    expect(mockedSessionContext.fetch).toHaveBeenCalledWith('session2', true);
  });

  it('should return empty array if context is not found for a session', async () => {
    const sessionIds = ['session1'];
    mockedSessionContext.fetch.mockResolvedValueOnce(null);
    const result = await fetchInterviewConversations(sessionIds);
    expect(result).toEqual([]);
  });

  it('should correctly map valid session contexts to interview conversations', async () => {
    const sessionIds = ['session1'];
    const question1: Partial<EnrichedQuestionDocument> = {
      id: 'q1',
      conversation: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    };
    const context1: Partial<SessionContextData> = {
      session: { id: 'session1' } as SessionDocument,
      skill: { mode: 'interview', name: 'Sales Interview' } as SkillDocument,
      questions: [question1 as EnrichedQuestionDocument],
    };

    mockedSessionContext.fetch.mockResolvedValueOnce(context1 as SessionContextData);

    const expectedConversation: InterviewConversation[] = [
      {
        sessionId: 'session1',
        questionId: 'q1',
        conversation: [
          { role: 'Candidate', content: 'Hello' },
          { role: 'Interviewer', content: 'Hi there' },
        ],
      },
    ];

    const result = await fetchInterviewConversations(sessionIds);
    expect(result).toEqual(expectedConversation);
  });

  it('should handle questions without conversations gracefully', async () => {
    const sessionIds = ['session1'];
    const question1: Partial<EnrichedQuestionDocument> = { id: 'q1', conversation: [] };
    const question2: Partial<EnrichedQuestionDocument> = { id: 'q2', conversation: undefined };
    const context1: Partial<SessionContextData> = {
      session: { id: 'session1' } as SessionDocument,
      skill: { mode: 'interview', name: 'Another Interview' } as SkillDocument,
      questions: [question1 as EnrichedQuestionDocument, question2 as EnrichedQuestionDocument],
    };

    mockedSessionContext.fetch.mockResolvedValueOnce(context1 as SessionContextData);

    const result = await fetchInterviewConversations(sessionIds);
    expect(result).toEqual([]);
  });

  it('should handle multiple sessions correctly', async () => {
    const sessionIds = ['session1', 'session2'];
    const q1: Partial<EnrichedQuestionDocument> = {
      id: 'q1',
      conversation: [{ role: 'user', content: 's1q1' }],
    };
    const q2: Partial<EnrichedQuestionDocument> = {
      id: 'q2',
      conversation: [{ role: 'user', content: 's2q2' }],
    };

    const context1: Partial<SessionContextData> = {
      session: { id: 'session1' } as SessionDocument,
      skill: { mode: 'interview', name: 'Skill 1' } as SkillDocument,
      questions: [q1 as EnrichedQuestionDocument],
    };
    const context2: Partial<SessionContextData> = {
      session: { id: 'session2' } as SessionDocument,
      skill: { mode: 'interview', name: 'Skill 2' } as SkillDocument,
      questions: [q2 as EnrichedQuestionDocument],
    };

    mockedSessionContext.fetch.mockImplementation(async (id) => {
      if (id === 'session1') return context1 as SessionContextData;
      if (id === 'session2') return context2 as SessionContextData;
      return null;
    });

    const result = await fetchInterviewConversations(sessionIds);
    expect(result).toHaveLength(2);
    expect(result.find((c) => c.sessionId === 'session1')?.conversation[0].content).toBe('s1q1');
    expect(result.find((c) => c.sessionId === 'session2')?.conversation[0].content).toBe('s2q2');
  });

  it('should return an empty array and log error if SessionContext.fetch throws', async () => {
    const sessionIds = ['session1'];
    const error = new Error('Fetch failed');
    mockedSessionContext.fetch.mockRejectedValueOnce(error);

    const result = await fetchInterviewConversations(sessionIds);
    expect(result).toEqual([]);
  });
});
