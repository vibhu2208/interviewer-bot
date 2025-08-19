import { AnswerAttemptedSubscription } from '../client/graphql/api';
import { InterviewBotClient } from '../client/interview-bot-client';
import { Persona } from '../personas/persona';
import { Observable, Subject } from 'rxjs';
import { take, shareReplay, takeUntil } from 'rxjs/operators';
import { CoreMessage } from 'ai';

/**
 * Manages the state and flow of a single interview conversation.
 */
export class Conversation {
  private readonly sessionId: string;
  private readonly questionId: string;
  private answerAttempt$: Observable<AnswerAttemptedSubscription['answerAttempted']>;
  private ngUnsubscribe = new Subject<void>();
  private lastResult: string | null = null;
  private messageQueue = new Subject<AnswerAttemptedSubscription['answerAttempted']>();
  private currentConversation: string = 'Hi';

  constructor(
    private readonly client: InterviewBotClient,
    private readonly persona: Persona,
    sessionId: string,
    questionId: string,
  ) {
    this.sessionId = sessionId;
    this.questionId = questionId;
    this.answerAttempt$ = this.client
      .subscribeToAnswerAttemptsObservable({
        sessionId: this.sessionId,
        questionId: this.questionId,
      })
      .pipe(takeUntil(this.ngUnsubscribe), shareReplay({ bufferSize: 1, refCount: true }));
    this.answerAttempt$.subscribe((msg) => {
      const result = msg?.result;

      if (msg?.state === 'Completed' || (result && result !== this.lastResult)) {
        if (result) {
          this.lastResult = result;
        }
        this.messageQueue.next(msg);
      } else {
        console.warn('[answerAttempt$] Skipping duplicate or incomplete message:', msg);
      }
    });
    console.log(`Initialized Conversation for session ${this.sessionId}, question ${this.questionId}`);
  }

  /**
   * Runs the entire interview conversation until completion.
   */
  public async runConversation(): Promise<CoreMessage[]> {
    console.log('Starting conversation...');
    await this.client.attemptAnswer({
      sessionId: this.sessionId,
      questionId: this.questionId,
      answer: 'Hi',
    });
    const next = await this.waitForNextMessage();
    let currentMessage = this.stripHtml(next?.result || '');

    while (true) {
      console.log(`[Interview Bot]: ${currentMessage}`);
      const reply = await this.persona.chat(currentMessage);
      console.log(`[${this.persona.name}]: ${reply}`);
      await this.client.attemptAnswer({
        sessionId: this.sessionId,
        questionId: this.questionId,
        answer: reply,
      });

      const next = await this.waitForNextMessage();
      if (!next || next.state === 'Completed') break;

      currentMessage = this.stripHtml(next.result || '');
    }

    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();

    return this.persona.conversation;
  }

  private waitForNextMessage(): Promise<AnswerAttemptedSubscription['answerAttempted']> {
    return new Promise((resolve) => {
      const sub = this.messageQueue.pipe(take(1)).subscribe(resolve);
    });
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>?/gm, '');
  }
}
