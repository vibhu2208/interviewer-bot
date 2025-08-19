import { defaultLogger } from '@trilogy-group/xoh-integration';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { generateSummary } from '../tasks/generate-summary';

const log = defaultLogger({ serviceName: 'generate-summary-rest' });

export async function handleGenerateSummaryCall(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Extract query parameters
    const transcriptionId = event.queryStringParameters?.transcriptionId;
    const promptId = event.queryStringParameters?.promptId ?? null;
    const save = event.queryStringParameters?.save === 'true';

    // Validate transcription ID is provided
    if (!transcriptionId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'transcriptionId is required' }),
      };
    }

    // Generate summary
    const summaryText = await generateSummary(transcriptionId, promptId, save);

    // Return successful response
    if (event.headers['Content-Type'] === 'text/plain') {
      return {
        statusCode: 200,
        body: summaryText,
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        summary: summaryText,
        transcriptionId,
        promptId,
        saved: save,
      }),
    };
  } catch (error) {
    log.error('Error generating summary', error as Error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to generate summary',
        details: error instanceof Error ? error.message : `${error}`,
      }),
    };
  }
}
