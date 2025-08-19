import { LambdaExecutor, ReindexCandidatesLambdaEvent } from './lambda-executor';
import { initLambda } from '../common/configs';
import { Context } from 'aws-lambda';

export async function handler(
  event: ReindexCandidatesLambdaEvent,
  context: Context,
): Promise<ReindexCandidatesLambdaEvent> {
  const { config } = await initLambda();
  const resultEvent = await new LambdaExecutor({
    event,
    context,
    config,
    clientMode: 'Single',
  }).run();

  console.log(`Done with Lambda execution; result: ${JSON.stringify(resultEvent, null, 2)}`);
  return resultEvent;
}
