import 'dotenv/config';
import { handler as allocateBudget } from './handlers/indeed-allocate-budget';
import { handler as generateFeed } from './handlers/indeed-feed-generator';
import { handler as fetchAnalytics } from './handlers/indeed-fetch-analytics';
import { handler as postWeeklyJobs } from './handlers/indeed-post-weekly-jobs';
import { verifyTitlesVariationUniqueness } from './handlers/verify-titles-variation-uniqueness';

export async function main() {
  //process.env.DRY_RUN = 'true';
  //await postWeeklyJobs();
  //await generateFeed();
  //await allocateBudget();
}

(async () => {
  try {
    await main();
  } catch (e) {
    console.error(e);
  }
})();
