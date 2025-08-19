import { SQSEvent } from 'aws-lambda';
import { initLambda } from '../common/configs';
import { EventParser } from '../common/event-parser';
import { BfqHandler } from './bfq-handler';

export async function handler(event: SQSEvent) {
  console.log(`Execute Index BFQ Lambda; event:${JSON.stringify(event, null, 2)}`);

  const { config } = await initLambda();

  const bfqHandler = new BfqHandler(config);
  const eventParser = new EventParser();

  const { Records: records } = event;
  for (const record of records) {
    const messages = eventParser.parseEvent(record);
    for (const message of messages) {
      switch (message.operation) {
        case 'update':
          await bfqHandler.update(message);
          break;
        case 'remove':
          await bfqHandler.remove(message);
          break;
        default:
          console.warn(`Unknown operation: ${message.operation}; skip event processing`);
      }
    }
  }
}
