# Site Recacher

The purpose of this script is to:

1. crawl the site and collect all URLs
2. register URLs in Prerender.io with [Recache API](https://docs.prerender.io/article/6-api#recache).
3. generate sitemap.xml and save it into site web bucket

# Configuration

- `rootUrl` - where to start crawling from
- `prerenderToken` - authentication token to use for Prerender call
- `ignoreUrlPatterns` - array of RegExp patterns, which will be used to determine whether the URL should be ignored or not. If URL is ignored, it will not be visited and registered in Prerender.
- `noloadUrlPatterns` - array of RegExp patterns, which will be used to determine whether the URL is a navigation dead end. If it is, then the page will not be rendered (saving time), and all the links from it will be ignored, but it still will be registered in Prerender.
- `noRecache` - skip Prerender registration stage, useful for crawl stage debugging, since all results will apppear in outputs.
