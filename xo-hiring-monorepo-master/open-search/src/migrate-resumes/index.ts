import { LambdaExecutor, MigrateResumesLambdaEvent } from './lambda-executor';
import { initLambdaWithSfClient } from '../common/configs';
import { Context } from 'aws-lambda';

export async function handler(event: MigrateResumesLambdaEvent, context: Context): Promise<MigrateResumesLambdaEvent> {
  const { config, sfClient } = await initLambdaWithSfClient();
  const resultEvent = await new LambdaExecutor({
    event,
    context,
    config,
    sfClient,
  }).run();

  console.log(`Done with Lambda execution; result: ${JSON.stringify(resultEvent, null, 2)}`);
  return resultEvent;
}
