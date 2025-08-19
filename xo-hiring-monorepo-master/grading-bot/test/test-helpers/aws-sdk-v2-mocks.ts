import AWSMock from 'aws-sdk-mock';
import { TestEnv } from './helpers';
import { GetParametersByPathResult, GetParametersRequest } from '@aws-sdk/client-ssm';

const ssmParameters = new Map<string, string>();

export async function setupSfClient() {
  ssmParameters.set('/xo-hiring/production/common/salesforce-app-account', JSON.stringify(TestEnv));
  ssmParameters.set(
    '/xo-hiring/production/salesforceAuthorizer/access_token',
    JSON.stringify([
      {
        user: 'test_user',
        token: 'test_access_token',
      },
    ]),
  );
  AWSMock.mock('SSM', 'getParameter', (req, callback) => {
    callback(undefined, { Parameter: { Value: ssmParameters.get(req.Name) } });
  });
  AWSMock.mock('SSM', 'putParameter', (req, callback) => {
    ssmParameters.set(req.Name, req.Value);
    callback(undefined, {});
  });

  process.env.ENV = 'production';
}

export async function tearDownSfClient() {
  AWSMock.restore('SSM');
  ssmParameters.clear();
  process.env.ENV = undefined;
}

export async function setupSsmConfig_v2() {
  AWSMock.mock('SSM', 'getParametersByPath', async (request: GetParametersRequest) => {
    return {
      Parameters: [
        {
          Name: '/xo-hiring/production/grading-bot/prompts/default-system',
          Type: 'String',
          Value:
            "ChatGPT, as an expert technical interviewer you are grading candidate's submission.\n" +
            'I will provide the grading rules. Rules can optionally provide good and bad examples.\n' +
            'Use rules and related weight scores (if present) to determine if the answer passes or not.\n',
          Version: 1,
        },
        {
          Name: '/xo-hiring/production/grading-bot/prompts/default-user',
          Type: 'String',
          Value: "Candidate's submission:\n" + '\n' + '[[content]]',
          Version: 1,
        },
        {
          Name: '/xo-hiring/production/grading-bot/prompts/sm-response-system',
          Type: 'String',
          Value:
            "ChatGPT, as an expert technical interviewer you are grading candidate's submission.\n" +
            'I will provide the grading rules. Rules can optionally provide good and bad examples.\n' +
            'Use rules and related weight scores (if present) to determine if the answer passes or not.\n',
          Version: 1,
        },
        {
          Name: '/xo-hiring/production/grading-bot/prompts/sm-response-user',
          Type: 'String',
          Value:
            "Candidate's submission:\n" +
            '\n' +
            '[[#each questionsAndAnswers]]\n' +
            'Answer [[inc @index]]: [[answer]].\n' +
            '\n' +
            '[[/each]]',
          Version: 1,
        },
        {
          Name: '/xo-hiring/production/grading-bot/prompts/table-structured-system',
          Type: 'String',
          Value:
            "ChatGPT, as an expert technical interviewer you are grading candidate's submission.\n" +
            'I will provide the grading rules. Rules can optionally provide good and bad examples.\n' +
            'Use rules and related weight scores (if present) to determine if the answer passes or not.\n',
          Version: 1,
        },
        {
          Name: '/xo-hiring/production/grading-bot/prompts/table-structured-user',
          Type: 'String',
          Value:
            "Candidate's submission:\n" +
            '\n' +
            'Sections:\n' +
            '[[#each sections]]\n' +
            'Section [[@index]]: [[header]].\n' +
            'Answer: [[content]]\n' +
            '\n' +
            '[[/each]]',
          Version: 1,
        },
      ],
    } as GetParametersByPathResult;
  });
}

export async function tearDownSsmConfig_v2() {
  AWSMock.restore('SSM');
}
