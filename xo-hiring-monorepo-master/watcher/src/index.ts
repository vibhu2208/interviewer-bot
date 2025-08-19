import * as zlib from 'zlib';
import { SNSEvent } from 'aws-lambda';
import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';
import { createBackendProductionBug } from '@trilogy-group/lambda-process/utils/jira';

// Event example:
// {
//     "Records": [
//         {
//             "EventSource": "aws:sns",
//             "EventVersion": "1.0",
//             "EventSubscriptionArn": "arn:aws:sns:us-east-1:104042860393:xo-hiring-cicd-failures:d097f387-2589-43c9-9525-6af181a986cc",
//             "Sns": {
//                 "Type": "Notification",
//                 "MessageId": "0632b371-2d6f-5f70-9989-e8c34e29f595",
//                 "TopicArn": "arn:aws:sns:us-east-1:104042860393:xo-hiring-cicd-failures",
//                 "Subject": "Production deployment failed.",
//                 "Message": "eJyrVkrPLMkoTXLOzytJrSjxKs7PU7JSUqmuVijJ9wr299OASGsq1NYq6Shl5eNWCJSDqiouSS0oxqkOLAtWWQsAvrwrNA==",
//                 "Timestamp": "2022-10-01T15:47:18.090Z",
//                 "SignatureVersion": "1",
//                 "Signature": "<...>",
//                 "SigningCertUrl": "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-56e67fcb41f6fec09b0196692625d385.pem",
//                 "UnsubscribeUrl": "https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:104042860393:xo-hiring-cicd-failures:d097f387-2589-43c9-9525-6af181a986cc",
//                 "MessageAttributes": {}
//             }
//         }
//     ]
// }

async function handleCicdFailure(rawMessage: string) {
  // sent from .github\workflows\production-deploy-on-master-push.yml
  const env = process.env.ENV;
  if (!env) {
    throw new Error('ENV environment variable is not set.');
  }

  const ssm = new SsmEditor({ environment: env });

  // decompress message
  const parsedMessage = JSON.parse(zlib.inflateSync(Buffer.from(rawMessage, 'base64')).toString('utf-8'));
  console.log('PAYLOAD ' + JSON.stringify(parsedMessage, null, 2));
  const github = JSON.parse(parsedMessage.githubContextJson);
  const runUrl = `https://github.com/${github.repository}/actions/runs/${github.run_id}`;

  // jira token
  const jiraToken = Buffer.from(await ssm.getString('common/jiraToken')).toString('base64');
  const resp = await createBackendProductionBug('10288', 'deployment failed', jiraToken, 'Maintenance', runUrl);
  console.log(`RESULT ${resp?.data}`);
}

export async function handler(event: SNSEvent) {
  console.log('EVENT ' + JSON.stringify(event, null, 2));

  const rawNotification = event.Records[0].Sns;

  if (rawNotification.TopicArn === 'arn:aws:sns:us-east-1:104042860393:xo-hiring-cicd-failures') {
    await handleCicdFailure(rawNotification.Message);
  }
}
