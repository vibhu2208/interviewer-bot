import { LambdaExecutor } from './lambda-executor';
import { initLambda } from '../common/configs';
import { Context } from 'aws-lambda';
import { LambdaEvent } from '../common/base-lambda-executor';

export async function handler(event: LambdaEvent, context: Context): Promise<LambdaEvent> {
  const { config } = await initLambda();
  const resultEvent = await new LambdaExecutor({
    event,
    context,
    config,
  }).run();

  console.log(`Done with Lambda execution; result: ${JSON.stringify(resultEvent, null, 2)}`);
  return resultEvent;
}
