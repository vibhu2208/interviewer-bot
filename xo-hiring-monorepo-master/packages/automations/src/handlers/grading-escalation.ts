import { defaultLogger } from '@trilogy-group/xoh-integration';
import { GradingEscalationService } from '../services/grading-escalation.service';

const log = defaultLogger({ serviceName: 'grading-escalation' });

/**
 * Main escalation handler that runs daily at 8 AM EST
 */
export async function checkGradingTasks(): Promise<void> {
  log.info('Starting grading escalation handler');

  const escalationService = new GradingEscalationService();
  await escalationService.runEscalationCheck();
}
