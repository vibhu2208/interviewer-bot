import { InterviewConversation } from '../model/interview-conversation.models';
import { Logger } from '../common/logger';
import { SessionContext } from '../common/session-context';

const log = Logger.create('interview-conversation-service');

export async function fetchInterviewConversations(sessionIds: string[]): Promise<InterviewConversation[]> {
  log.info(`Fetching matching interview conversations for ${sessionIds.length} session(s)`);

  if (sessionIds.length === 0) {
    log.info('No session IDs provided, returning empty array.');
    return [];
  }

  try {
    const sessionContextPromises = sessionIds.map((sessionId) => SessionContext.fetch(sessionId, true));
    const sessionContexts = await Promise.all(sessionContextPromises);

    const validContexts = sessionContexts.filter((context): context is NonNullable<typeof context> => {
      if (!context) {
        return false;
      }
      if (context.skill.mode !== 'interview') {
        log.info(`Skipping session ${context.session.id} as skill mode is not 'interview'`, {
          sessionId: context.session.id,
          skillMode: context.skill.mode,
        });
        return false;
      }
      return true;
    });

    log.info(`Found ${validContexts.length} valid session contexts with 'interview' mode.`);

    const result: InterviewConversation[] = validContexts.flatMap((context) => {
      return context.questions
        .filter((question) => question.conversation && question.conversation.length > 0)
        .map((question) => {
          log.info(`Adding matching interview conversation for session ${context.session.id}, question ${question.id}`);
          return {
            sessionId: context.session.id,
            questionId: question.id,
            conversation: question.conversation!.map((it) => ({
              role: it.role === 'user' ? 'Candidate' : 'Interviewer',
              content: it.content,
            })),
          };
        });
    });

    log.info(`Successfully fetched ${result.length} AI matching interview logs.`);
    return result;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    log.error('Error fetching AI matching interview logs:', error);
    return [];
  }
}
