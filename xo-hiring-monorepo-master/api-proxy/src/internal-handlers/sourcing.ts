import { InvokeCommand, InvokeCommandInput, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, NoSuchKey, S3Client } from '@aws-sdk/client-s3';
import { Elements, IContentItem } from '@kontent-ai/delivery-sdk';
import { defaultLogger } from '@trilogy-group/xoh-integration';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { axiosResponse, HttpStatusCodes } from '../responses';

const log = defaultLogger({ serviceName: 'sourcing' });
const s3 = new S3Client({
  region: process.env.AWS_REGION,
});
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

export class Sourcing {
  public static async getJobAdTitleVariations(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    try {
      // Extract optional path parameter titlesIds
      const titleIds = event.pathParameters?.titleIds || '';
      // Split the titlesIds string into an array
      const idArray = titleIds.split(',').filter((id) => id.trim() !== '');

      const fetchedData = (await Promise.all(idArray.map((id) => Sourcing.fetchJobAdTitleVariation(id)))).filter(
        (it) => it != null,
      );

      return axiosResponse(HttpStatusCodes.Ok, {
        items: fetchedData,
      });
    } catch (error) {
      log.error('Error fetching job ad title variations', error as Error);
      return axiosResponse(HttpStatusCodes.Ok, {
        items: [],
      });
    }
  }

  public static async fetchJobAdTitleVariation(jobTitleId: string): Promise<VariationOutput | null> {
    log.appendKeys({ jobTitleId });
    try {
      const content = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.SOURCING_INTERNAL_BUCKET,
          Key: `ad-title-variations/${jobTitleId}.json`,
        }),
      );
      if (content?.Body != null) {
        const bodyContents = await content.Body.transformToString();
        const kontentItem = JSON.parse(bodyContents) as KontentPipelineItem;
        log.debug(`Fetched job ad title variation for job title id`);
        return {
          ...kontentItem,
          titleId: jobTitleId,
        };
      }
    } catch (e) {
      if (e instanceof NoSuchKey) {
        log.debug(`No job ad title variation found for job title id`);
      } else {
        log.error(`Error fetching job ad title variation for job title id`, e as Error);
      }
    }
    log.resetKeys();
    return null;
  }

  public static async triggerJobAdVariationGeneration(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    try {
      const lambdaName = process.env.SOURCING_GENERATOR_LAMBDA_NAME;
      log.info(`Triggering job ad variation generation on lambda ${lambdaName}`);
      const command = new InvokeCommand({
        FunctionName: lambdaName,
        InvocationType: 'Event', // This makes the invocation asynchronous
      });
      await lambdaClient.send(command);

      log.info('Successfully triggered job ad variation generation');
      return axiosResponse(HttpStatusCodes.Ok, {
        message: 'Job ad variation generation triggered successfully',
      });
    } catch (error) {
      log.error('Error triggering job ad variation generation', error as Error);
      return axiosResponse(HttpStatusCodes.InternalServerError, {
        message: `Failed to trigger job ad variation generation: ${(error as Error).message}`,
      });
    }
  }
}

type VariationOutput = KontentPipelineItem & {
  titleId: string;
};

type KontentPipelineItem = IContentItem<{
  pipeline_code: Elements.NumberElement;
  hook: Elements.RichTextElement;
  what_you_will_be_doing: Elements.RichTextElement;
  what_you_will_not_be_doing: Elements.RichTextElement;
  responsibilities: Elements.RichTextElement;
  requirements: Elements.RichTextElement;
  nice_to_have: Elements.RichTextElement;
  what_you_will_learn: Elements.RichTextElement;
  work_examples: Elements.RichTextElement;
  primary_contribution: Elements.RichTextElement;
}>;
