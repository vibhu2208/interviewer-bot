import 'dotenv/config';
import { Octokit } from '@octokit/rest';
import { S3Utils } from '@trilogy-group/lambda-cdk-infra';
import { S3Client, ListBucketsCommand, DeleteBucketCommand, NoSuchBucket, HeadBucketCommand } from '@aws-sdk/client-s3';
import {
  IAMClient,
  ListRolesCommand,
  ListRolePoliciesCommand,
  DeleteRolePolicyCommand,
  ListAttachedRolePoliciesCommand,
  DetachRolePolicyCommand,
  DeleteRoleCommand,
  NoSuchEntityException,
} from '@aws-sdk/client-iam';
import {
  CloudFrontClient,
  ListDistributionsCommand,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  DeleteDistributionCommand,
} from '@aws-sdk/client-cloudfront';
import { APIGatewayClient, GetRestApisCommand, DeleteRestApiCommand } from '@aws-sdk/client-api-gateway';
import { SSMClient, GetParametersByPathCommand, DeleteParametersCommand } from '@aws-sdk/client-ssm';
import {
  CloudFormationClient,
  ListStacksCommand,
  DeleteStackCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import {
  LambdaClient,
  ListFunctionsCommand,
  DeleteFunctionCommand,
  InvalidParameterValueException,
} from '@aws-sdk/client-lambda';
import { defaultLogger } from '@trilogy-group/xoh-integration';
import { cleanupCloudwatchLogs } from './cleanup-cloudwatch-logs';
import { classifyEnvironment, sleep } from './utils/env-classifier';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const s3Client = new S3Client();
const iamClient = new IAMClient();
const cfnClient = new CloudFrontClient();
const apiClient = new APIGatewayClient();
const ssmClient = new SSMClient({});
const cfmClient = new CloudFormationClient();
const lambdaClient = new LambdaClient();

const log = defaultLogger({
  logLevel: 'debug',
});

const Owner = 'trilogy-group';
const Repositories = {
  // XoHiring: 'xo-hiring', // Does not have any AWS deployments
  WsFrontendMono: 'ws-frontend-monorepo',
  XoHiringMono: 'xo-hiring-monorepo',
  XoHiringAdmin: 'xo-hiring-admin',
  XoJobRecommender: 'xo-job-recommender',
};
const PrStatusCache: PullRequestStatus[] = [];

async function cacheOpenPullRequestStatuses(): Promise<void> {
  log.info('Caching open pull request statuses...');
  let totalOpenPrsCached = 0;
  for (const repo of Object.values(Repositories)) {
    let repoOpenPrCount = 0;
    try {
      const pulls = await octokit.paginate(octokit.rest.pulls.list, {
        owner: Owner,
        repo: repo,
        state: 'open',
        per_page: 100,
      });

      for (const pull of pulls) {
        PrStatusCache.push({ repo, pull_number: pull.number });
        repoOpenPrCount++;
      }
      log.info(`Cached ${repoOpenPrCount} open PRs for repository ${repo}.`);
      totalOpenPrsCached += repoOpenPrCount;
    } catch (error) {
      log.error(`Error fetching or caching open PRs for repository ${repo}: ${error}`);
    }
  }
  log.info(`Finished caching. Total open PRs cached across all repositories: ${totalOpenPrsCached}.`);
}

function isPrClosed(number: number): boolean {
  const openPRsByNumber = PrStatusCache.filter((pr) => pr.pull_number === number);

  // We use a simplification here, if we have no opened PR with such number in ANY repo it means it is for sure closed
  // We typically do not have many open PRs, so it should have pretty good cleanup results
  return openPRsByNumber.length === 0;
}

async function cleanupCloudFormationStacks(): Promise<number> {
  let stacksToRemove = 0;
  let nextToken: string | undefined;
  do {
    const response = await cfmClient.send(
      new ListStacksCommand({
        NextToken: nextToken,
        StackStatusFilter: [
          StackStatus.CREATE_COMPLETE,
          StackStatus.UPDATE_COMPLETE,
          StackStatus.ROLLBACK_COMPLETE,
          StackStatus.UPDATE_ROLLBACK_COMPLETE,
          StackStatus.DELETE_FAILED,
        ],
      }),
    );
    for (const stack of response.StackSummaries || []) {
      if (stack.StackStatus === StackStatus.DELETE_FAILED) {
        log.debug(`[CloudFormation] Retrying deletion for stack ${stack.StackName} in DELETE_FAILED state`);
        await cfmClient.send(new DeleteStackCommand({ StackName: stack.StackName }));
        stacksToRemove++;
      } else {
        if (stack.StackName == null) {
          continue;
        }
        const env = classifyEnvironment(stack.StackName);
        if (env.classification === 'preview' && env.prNumber != null) {
          if (isPrClosed(env.prNumber)) {
            log.info(
              `[CloudFormation] Stack ${stack.StackName} with number ${env.prNumber} has no registered open PR and will be removed`,
            );
            await cfmClient.send(new DeleteStackCommand({ StackName: stack.StackName }));
            stacksToRemove++;
          } else {
            log.debug(
              `[CloudFormation] Stack ${stack.StackName} with number ${env.prNumber} has registered open PRs (skip)`,
            );
          }
        }
      }
    }
    nextToken = response.NextToken;
  } while (nextToken);
  return stacksToRemove;
}

async function cleanupS3Buckets(): Promise<number> {
  let bucketsToRemove = 0;
  const bucketsResponse = await s3Client.send(new ListBucketsCommand({}));
  for (const bucket of bucketsResponse.Buckets || []) {
    if (bucket.Name == null) {
      continue;
    }
    const env = classifyEnvironment(bucket.Name);
    if (env.classification === 'preview' && env.prNumber != null) {
      if (isPrClosed(env.prNumber)) {
        log.info(
          `[S3] Bucket ${bucket.Name} with number ${env.prNumber} has no registered open PR and will be removed`,
        );
        try {
          // Check if the bucket actually exists
          await s3Client.send(new HeadBucketCommand({ Bucket: bucket.Name }));
          await S3Utils.cleanupS3Bucket(bucket.Name);
          await s3Client.send(new DeleteBucketCommand({ Bucket: bucket.Name }));
        } catch (error) {
          if (error instanceof NoSuchBucket) {
            log.debug(`[S3] Bucket ${bucket.Name} was listed but does not actually exist. Skipping.`);
          } else {
            log.error(`[S3] Error checking bucket ${bucket.Name}: ${error}`, error as Error);
          }
        }
        bucketsToRemove++;
      } else {
        log.debug(`[S3] Bucket ${bucket.Name} with number ${env.prNumber} has registered open PRs (skip)`);
      }
    }
  }
  return bucketsToRemove;
}

async function cleanupIAMRoles(): Promise<number> {
  let rolesToRemove = 0;
  let marker: string | undefined;
  do {
    const rolesResponse = await iamClient.send(new ListRolesCommand({ Marker: marker }));
    for (const role of rolesResponse.Roles || []) {
      if (role.RoleName == null) {
        continue;
      }
      const env = classifyEnvironment(role.RoleName);
      if (env.classification === 'preview' && env.prNumber != null) {
        if (isPrClosed(env.prNumber)) {
          log.info(
            `[IAM] Role ${role.RoleName} with number ${env.prNumber} has no registered open PR and will be removed`,
          );
          const rolePolicies = await iamClient.send(new ListRolePoliciesCommand({ RoleName: role.RoleName }));
          for (const policy of rolePolicies.PolicyNames || []) {
            log.debug(`[IAM]   Deleting inline policy ${policy}`);
            await iamClient.send(new DeleteRolePolicyCommand({ RoleName: role.RoleName, PolicyName: policy }));
          }
          const attachedPolicies = await iamClient.send(
            new ListAttachedRolePoliciesCommand({ RoleName: role.RoleName }),
          );
          for (const policy of attachedPolicies.AttachedPolicies || []) {
            if (policy.PolicyArn?.startsWith('arn:aws:iam::aws:policy')) {
              // Managed policy - detach
              log.debug(`[IAM]   Detaching policy ${policy.PolicyArn}`);
              await iamClient.send(
                new DetachRolePolicyCommand({ RoleName: role.RoleName, PolicyArn: policy.PolicyArn }),
              );
            } else {
              log.debug(`[IAM]   Deleting policy ${policy.PolicyName} / ${policy.PolicyArn}`);
              try {
                await iamClient.send(
                  new DeleteRolePolicyCommand({ RoleName: role.RoleName, PolicyName: policy.PolicyName }),
                );
              } catch (error) {
                if (error instanceof NoSuchEntityException) {
                  // This happens for some weird customer-manager service roles
                  await iamClient.send(
                    new DetachRolePolicyCommand({ RoleName: role.RoleName, PolicyArn: policy.PolicyArn }),
                  );
                } else {
                  throw error;
                }
              }
            }
          }
          await iamClient.send(new DeleteRoleCommand({ RoleName: role.RoleName }));
          rolesToRemove++;
        } else {
          log.debug(`[IAM] Role ${role.RoleName} with number ${env.prNumber} has registered open PRs (skip)`);
        }
      }
    }
    marker = rolesResponse.Marker;
  } while (marker);
  return rolesToRemove;
}

async function cleanupCloudFrontDistributions(): Promise<number> {
  let distributionsToRemove = 0;
  let nextMarker: string | undefined;
  do {
    const distributionsResponse = await cfnClient.send(new ListDistributionsCommand({ Marker: nextMarker }));
    for (const distribution of distributionsResponse.DistributionList?.Items || []) {
      if (distribution.Id == null) {
        continue;
      }
      const checkForEnv = [distribution.Comment, ...(distribution.Origins?.Items?.map((it) => it.DomainName) ?? [])];
      const env = checkForEnv
        .filter((it) => it != null)
        .map((it) => classifyEnvironment(it as string))
        .find((it) => it.classification === 'preview' && it.prNumber != null);
      if (env?.classification === 'preview' && env?.prNumber != null) {
        if (isPrClosed(env.prNumber)) {
          const domain = distribution.Aliases?.Items?.length ? distribution.Aliases.Items[0] : distribution.DomainName;
          log.info(
            `[CloudFront] Distribution ${distribution.Id} (https://${domain}) for PR #${env.prNumber} has no registered open PR and will be removed`,
          );
          const config = await cfnClient.send(new GetDistributionConfigCommand({ Id: distribution.Id }));
          if (config.DistributionConfig?.Enabled) {
            log.info(
              `[CloudFront] Disabling distribution ${distribution.Id} and moving on. Re-run script later to remove`,
            );
            await cfnClient.send(
              new UpdateDistributionCommand({
                Id: distribution.Id,
                IfMatch: config.ETag,
                DistributionConfig: {
                  ...config.DistributionConfig,
                  Enabled: false,
                },
              }),
            );
          } else {
            if (distribution.Status === 'Deployed') {
              log.info(`[CloudFront] Deleting distribution ${distribution.Id}`);
              await cfnClient.send(new DeleteDistributionCommand({ Id: distribution.Id, IfMatch: config.ETag }));
              distributionsToRemove++;
            } else {
              log.warn(
                `[CloudFront] Distribution ${distribution.Id} is in status: ${distribution.Status}. Re-run script later to remove`,
              );
            }
          }
        } else {
          const domain = distribution.Aliases?.Items?.length ? distribution.Aliases.Items[0] : distribution.DomainName;
          log.debug(
            `[CloudFront] Distribution ${distribution.Id} (https://${domain}) for PR #${env.prNumber} has registered open PRs (skip)`,
          );
        }
      }
    }
    nextMarker = distributionsResponse.DistributionList?.NextMarker;
  } while (nextMarker);
  return distributionsToRemove;
}

async function cleanupApiGateway(): Promise<number> {
  let apisToRemove = 0;
  const apiResponse = await apiClient.send(new GetRestApisCommand({}));
  for (const item of apiResponse.items || []) {
    if (item.name == null || item.id == null) {
      continue;
    }
    const env = classifyEnvironment(item.name);
    if (env.classification === 'preview' && env.prNumber != null) {
      if (isPrClosed(env.prNumber)) {
        log.info(
          `[APIGateway] RestApi ${item.name} for PR #${env.prNumber} has no registered open PR and will be removed`,
        );
        await apiClient.send(new DeleteRestApiCommand({ restApiId: item.id }));
        apisToRemove++;
        await sleep(30000); // There is a huge request limit
      } else {
        log.debug(`[APIGateway] RestApi ${item.name} for PR #${env.prNumber} has registered open PRs (skip)`);
      }
    }
  }
  return apisToRemove;
}

async function cleanupSsmParameters(): Promise<number> {
  let paramsToRemove = 0;
  let nextTokenSsm: string | undefined;
  do {
    const ssmResponse = await ssmClient.send(
      new GetParametersByPathCommand({
        Path: '/xo-hiring',
        Recursive: true,
        NextToken: nextTokenSsm,
        MaxResults: 10,
      }),
    );
    const names: string[] = [];
    for (const param of ssmResponse.Parameters || []) {
      if (param.Name == null) {
        continue;
      }
      const env = classifyEnvironment(param.Name);
      if (env.classification === 'preview' && env.prNumber != null) {
        if (isPrClosed(env.prNumber)) {
          log.info(
            `[SSM] Parameter ${param.Name} for PR #${env.prNumber} has no registered open PR and will be removed`,
          );
          names.push(param.Name);
          paramsToRemove++;
        } else {
          log.debug(`[SSM] Parameter ${param.Name} for PR #${env.prNumber} has registered open PRs (skip)`);
        }
      }
    }
    if (names.length > 0) {
      await ssmClient.send(new DeleteParametersCommand({ Names: names }));
    }
    nextTokenSsm = ssmResponse.NextToken;
  } while (nextTokenSsm);
  return paramsToRemove;
}

async function cleanupLambdaFunctions(): Promise<number> {
  let functionsToRemove = 0;
  let marker: string | undefined;
  do {
    const listFunctionsResponse = await lambdaClient.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
    for (const func of listFunctionsResponse.Functions || []) {
      if (func.FunctionName == null) {
        continue;
      }
      const env = classifyEnvironment(func.FunctionName);
      if (env.classification === 'preview' && env.prNumber != null) {
        if (isPrClosed(env.prNumber)) {
          log.info(
            `[Lambda] Function ${func.FunctionName} for PR #${env.prNumber} has no registered open PR and will be removed`,
          );
          try {
            await lambdaClient.send(new DeleteFunctionCommand({ FunctionName: func.FunctionName }));
            functionsToRemove++;
          } catch (error) {
            if (error instanceof InvalidParameterValueException && error.message.includes('replicated function')) {
              log.warn(`[Lambda] Cannot delete ${func.FunctionName} because it's an edge lambda`);
            } else {
              throw error;
            }
          }
        } else {
          log.debug(`[Lambda] Function ${func.FunctionName} for PR #${env.prNumber} has registered open PRs (skip)`);
        }
      }
    }
    marker = listFunctionsResponse.NextMarker;
  } while (marker);
  return functionsToRemove;
}

async function main() {
  await cacheOpenPullRequestStatuses();

  const stacksToRemove = await cleanupCloudFormationStacks();
  const bucketsToRemove = await cleanupS3Buckets();
  const rolesToRemove = await cleanupIAMRoles();
  const distributionsToRemove = await cleanupCloudFrontDistributions();
  const apisToRemove = await cleanupApiGateway();
  const paramsToRemove = await cleanupSsmParameters();
  const functionsToRemove = await cleanupLambdaFunctions();

  await cleanupCloudwatchLogs();

  log.info('============================================');
  log.info('============================================');
  log.info(`Total S3 buckets to remove: ${bucketsToRemove}`);
  log.info(`Total IAM roles to remove: ${rolesToRemove}`);
  log.info(`Total CloudFront distributions to remove: ${distributionsToRemove}`);
  log.info(`Total ApiGateway APIs to remove: ${apisToRemove}`);
  log.info(`Total SSM Parameters to remove: ${paramsToRemove}`);
  log.info(`Total Lambda functions to remove: ${functionsToRemove}`);
  log.info(`Total CloudFormation stacks to remove: ${stacksToRemove}`);
}

interface PullRequestStatus {
  repo: string;
  pull_number: number;
}

if (require.main === module) {
  main().catch(console.error);
}
