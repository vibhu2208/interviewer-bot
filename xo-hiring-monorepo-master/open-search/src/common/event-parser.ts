import { S3Event, S3EventRecord } from 'aws-lambda/trigger/s3';
import { SQSRecord } from 'aws-lambda/trigger/sqs';
import _ from 'lodash';
import { IndexItemMessage } from './types';

export class EventParser {
  parseEvent(sqsRecord: SQSRecord): Array<IndexItemMessage> {
    const { body, messageAttributes } = sqsRecord;
    const messageSource = messageAttributes['messageSource'];
    try {
      if (messageSource?.stringValue === 'oos') {
        // Message sent from Open Search indexing
        return [JSON.parse(body) as IndexItemMessage];
      }
      // Message sent from S3 bucket
      const s3Event = JSON.parse(body) as S3Event;
      const { Records: records } = s3Event;

      if (records.length === 0) {
        console.warn('Got an empty records array from S3 event; skip further processing');
      } else {
        return records.map((record) => this.parseS3Event(record));
      }
    } catch (err) {
      console.error('Invalid structure of the received event', err);
    }
    return [{ operation: undefined }];
  }

  parseS3Event(eventRecord: S3EventRecord): IndexItemMessage {
    const {
      eventName,
      s3: {
        object: { key },
      },
    } = eventRecord;

    const candidateId = this.getCandidateId(key);
    const [eventType] = eventName.split(':');
    switch (eventType) {
      // There is no such event Type like "ObjectUpdated"
      case 'ObjectCreated':
        return { operation: 'update', candidateId, objectKey: key };
      case 'ObjectRemoved':
        return { operation: 'remove', candidateId, objectKey: key };
      default:
        console.warn(`Unsupported event name: ${eventName}`);
    }

    return { operation: undefined };
  }

  /**
   * Returns a candidate key 'XXXXXXXXX' from a key like `path/XXXXXXXXX.json'
   */
  getCandidateId(key: string): string {
    const fileName = _.last(_.split(key, '/')) ?? key;
    const index = fileName.lastIndexOf('.');
    return index < 0 ? fileName : fileName.substr(0, index);
  }
}
