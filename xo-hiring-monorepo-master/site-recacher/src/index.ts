import puppeteer, { Page } from 'puppeteer';
import { URL } from 'url';
import axios from 'axios';
import chunk from 'lodash.chunk';
import { z } from 'zod';
import * as AWS from 'aws-sdk';
import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';

export const SiteRecacherConfigType = z.object({
  /**
   * Where to start crawling from.
   */

  rootUrl: z.string().url(),
  /**
   * Which URLs to skip during crawling.
   */
  ignoreUrlPatterns: z.array(z.string().transform((p) => new RegExp(p, 'i'))),
  /**
   * Which URLs should not be loaded during crawling.
   * They still will be indexed, but not their children.
   * This is a performance optimization.
   */
  noloadUrlPatterns: z.array(z.string().transform((p) => new RegExp(p, 'i'))),
  /**
   * Skip Prerender recaching
   */
  noRecache: z.boolean().optional(),
  /**
   * Where to put generated sitemap.xml
   */
  siteBucketName: z.string(),
  /**
   * Where to get Prerender Token
   */
  prerenderSecretName: z.string(),

  prerenderSecretRegion: z.string().default(process.env.AWS_REGION as string),

  /** How much time to wait for a page load, in milliseconds. */
  timeoutMs: z.number().default(10000),
});

export type SiteRecacherConfig = z.infer<typeof SiteRecacherConfigType>;

const findPattern = (regExps: RegExp[], url: string) => {
  for (let i = 0; i < regExps.length; i++) {
    if (regExps[i].test(url)) {
      return i;
    }
  }
  return -1;
};

async function visitUrl(
  config: SiteRecacherConfig,
  page: Page,
  url: URL,
  visited: Set<string>,
  ignored: Map<string, string>,
  repeatNum?: number,
) {
  if (visited.has(url.href)) {
    return;
  }
  visited.add(url.href);

  // visit without loading the page to save time
  const noloadPattern = findPattern(config.noloadUrlPatterns, url.href);
  if (noloadPattern >= 0) {
    console.log(`NOLOAD (${noloadPattern}): ${url.href}`);
    return;
  }

  console.log(`NAVIGATE: ${url.href}`);

  try {
    await page.goto(url.href, {
      waitUntil: 'networkidle2',
      timeout: config.timeoutMs,
    });
  } catch (error) {
    if (!repeatNum || repeatNum < 10) {
      console.warn(error);
      console.warn(`Error during navigation (${(repeatNum || 0) + 1}), retrying.`);
      visited.delete(url.href);
      await visitUrl(config, page, url, visited, ignored, repeatNum ? repeatNum + 1 : 1);
    } else {
      ignored.set(url.toString(), `ERROR-${(error as Error).message}`);
      console.error(`Error during navigation - skip.`);
    }
    return;
  }

  const aElements = await page.$$('a');
  const aHrefHandles = await Promise.all(aElements.map((ae) => ae.getProperty('href')));
  const aHrefValues = await Promise.all(
    aHrefHandles.map((h) => (h === undefined ? Promise.resolve('') : h.jsonValue())),
  );

  if (aHrefValues.length == 0) {
    // TODO: this happens for unknown reason sometimes
    if (!repeatNum || repeatNum < 10) {
      console.log('Page has no links - repeat.');
      visited.delete(url.href);
      await visitUrl(config, page, url, visited, ignored, repeatNum ? repeatNum + 1 : 1);
    } else {
      console.log('Page has no links - fail.');
      throw new Error('Page has no links');
    }
    return;
  }

  for (const href of aHrefValues) {
    try {
      if (typeof href !== 'string' || href.length == 0) {
        continue;
      }
      const childUrl = new URL(href);

      if (childUrl.protocol !== 'https:' && childUrl.protocol !== 'http:') {
        ignored.set(childUrl.href, 'protocol');
        continue;
      }

      if (childUrl.hostname !== url.hostname) {
        ignored.set(childUrl.href, 'hostname');
        continue;
      }

      const ignorePattern = findPattern(config.ignoreUrlPatterns, childUrl.href);
      if (ignorePattern >= 0) {
        ignored.set(childUrl.href, `ignore_pattern_${ignorePattern}`);
        continue;
      }

      await visitUrl(config, page, childUrl, visited, ignored);
    } catch (e) {
      console.log(`Error processing URL: ${href} from ${url.href} : ${e}`);
    }
  }
}

async function getPrerenderSecret(config: SiteRecacherConfig) {
  const smClient = new AWS.SecretsManager({
    region: config.prerenderSecretRegion,
  });

  const secretResp = await smClient.getSecretValue({ SecretId: config.prerenderSecretName }).promise();
  if (secretResp.$response.error || !secretResp.SecretString) {
    throw new Error(
      `Failed to get secret '${config.prerenderSecretName}' in '${config.prerenderSecretRegion}'. ${secretResp.$response.error}`,
    );
  }

  return z.object({ prerenderToken: z.string() }).parse(JSON.parse(secretResp.SecretString) as unknown);
}

async function recache(urls: string[], config: SiteRecacherConfig) {
  for (const batch of chunk(urls, 300)) {
    const resp = await axios.post('https://api.prerender.io/recache', {
      prerenderToken: (await getPrerenderSecret(config)).prerenderToken,
      urls: batch,
    });
    console.log(`Prerender recache response status: ${resp.status}`);
  }
}

function generateSitemap(urls: string[]) {
  return `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${urls.map((url) => `<url><loc>${url}</loc></url>`).join('\n    ')}
  </urlset>`;
}

async function publishSitemap(config: SiteRecacherConfig, sitemap: string) {
  const s3 = new AWS.S3();
  const key = 'sitemap.xml';
  const putObjectReq: AWS.S3.PutObjectRequest = {
    Key: key,
    Bucket: config.siteBucketName,
    Body: sitemap,
    ContentType: 'text/xml',
  };
  const putResult = await s3.putObject(putObjectReq).promise();
  if (putResult.$response.error) {
    throw new Error(`Failed to save sitemap: ${putResult.$response.error}`);
  }
  console.log(`Sitemap saved. ${putResult.$response.httpResponse.statusCode}`);
}

export async function handler() {
  const env = process.env.ENV;
  if (!env) {
    throw new Error(`Environment variable 'ENV' is not set.`);
  }

  const ssm = new SsmEditor({ environment: env });
  const config = await ssm.getJson(SiteRecacherConfigType, 'site-recacher/config');

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
    ignoreHTTPSErrors: true,
  });

  const page = await browser.newPage();

  // crawling
  console.time('crawl');
  const visitedUrls = new Set<string>();
  const ignoredUrls = new Map<string, string>();
  await visitUrl(config, page, new URL(config.rootUrl), visitedUrls, ignoredUrls);
  console.timeEnd('crawl');

  //
  console.log(`Ignored URLs:`);
  for (const ignoredUrl of ignoredUrls.keys()) {
    console.log(`${ignoredUrl} - ${ignoredUrls.get(ignoredUrl)}`);
  }

  const urls = Array.from(visitedUrls);
  console.log(`Crawling finished, ${urls.length} URLs found.`);

  if (config.noRecache) {
    console.log('Skipping Prerender recache stage.');
  } else {
    await recache(urls, config);
  }

  await publishSitemap(config, generateSitemap(urls));

  await browser.close();
}

// for local development
if (process.env.INVOKE_HANDLER) {
  handler();
}
