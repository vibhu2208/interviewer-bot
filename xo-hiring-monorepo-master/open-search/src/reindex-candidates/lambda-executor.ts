import { Context } from 'aws-lambda';
import { OpenSearchConfig } from '../common/configs';
import { EARLY_EXIT_THRESHOLD } from '../common/constants';
import { search } from '../common/index-mappings';
import { OpenSearchClient } from '../common/open-search-util';

export interface ReindexCandidatesLambdaEvent {
  sourceCollection?: string;
  sourceIndex?: string;
  destCollection?: string;
  destIndex?: string;
  aliasName?: string;
  copied?: number;
  searchAfter?: string;
}

interface ReindexCandidatesLambdaContext {
  event: ReindexCandidatesLambdaEvent;
  context: Context;
  config: OpenSearchConfig;
  clientMode: 'Single' | 'Multi';
}

export class LambdaExecutor {
  readonly ctx: ReindexCandidatesLambdaContext;

  constructor(ctx: ReindexCandidatesLambdaContext) {
    this.ctx = ctx;
  }

  async run(): Promise<ReindexCandidatesLambdaEvent> {
    if (!process.env.COLLECTION_ENDPOINT) {
      throw new Error('Required env vars are missing: COLLECTION_ENDPOINT');
    }

    const event = this.ctx.event;
    if (event.sourceIndex === undefined || event.destIndex === undefined || event.aliasName === undefined) {
      throw new Error('Required parameters are missing: sourceIndex, destIndex, aliasName');
    }
    console.log(`Copying data from ${event.sourceIndex} to ${event.destIndex} for alias: ${event.aliasName}`);

    const srcCollection =
      event.sourceCollection === undefined ? process.env.COLLECTION_ENDPOINT : event.sourceCollection;
    const destCollection = event.destCollection === undefined ? process.env.COLLECTION_ENDPOINT : event.destCollection;
    if (srcCollection !== destCollection) {
      this.ctx.clientMode = 'Multi';
      console.log(`Executing multi-client mode from ${srcCollection} to ${destCollection}`);
    }

    const srcClient = new OpenSearchClient(this.ctx.config.serviceName, srcCollection);
    const destClient =
      this.ctx.clientMode === 'Single' ? srcClient : new OpenSearchClient(this.ctx.config.serviceName, destCollection);

    await destClient.createIndexWithMappingForAlias(event.destIndex, event.aliasName, search);

    // Copy all data from sourceIndex to destIndex using search_after API
    event.copied = event.copied ?? 0;
    let done = false;
    while (!done) {
      const hits = await srcClient.searchDataForReindexing(event.sourceIndex, event.searchAfter);
      const copyAllDataResponse = await destClient.saveDataForReindexing(event.destIndex, hits);
      done = copyAllDataResponse.done;
      event.copied += copyAllDataResponse.hits;
      event.searchAfter = done ? undefined : copyAllDataResponse.searchAfter;

      if (this.ctx.context.getRemainingTimeInMillis() < 2 * EARLY_EXIT_THRESHOLD) {
        break;
      }
    }
    console.log(`Copied ${event.copied} documents`);

    if (done) {
      await destClient.updateIndicesForAlias(event.sourceIndex, event.destIndex, event.aliasName);
    }

    return Promise.resolve(event);
  }
}
