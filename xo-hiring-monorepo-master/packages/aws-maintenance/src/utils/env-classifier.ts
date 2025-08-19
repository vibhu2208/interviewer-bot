export type EnvironmentClassification = 'preview' | 'sandbox' | 'production' | null;

/**
 * Extracts the environment classification (preview/sandbox/prod) and the actual environment name
 * from an AWS resource name.
 *
 * The rules are:
 *  - Preview environments contain `-pr<number>-`, e.g. `service-pr12-api` ➜ env name `pr12`
 *  - Sandbox environments contain `-sand-` ➜ env name `sand`, or `-sandbox-` ➜ env name `sandbox`
 *  - Production environments contain `-prod-` ➜ env name `prod`, or `-production-` ➜ env name `production`
 *
 * @param resourceName AWS resource name to inspect
 * @returns Object with the detected classification and environment name (or null if none matched)
 */
export function classifyEnvironment(resourceName: string): {
  classification: EnvironmentClassification;
  envName: string | null;
  prNumber?: number;
} {
  if (!resourceName) {
    return { classification: null, envName: null };
  }

  // Normalise to lowercase for case-insensitive comparison
  const name = resourceName.toLowerCase();

  // Preview (pull-request) environments – look for '-pr<number>-' pattern
  const previewMatch = name.match(/-pr(\d+)-/);
  if (previewMatch) {
    return {
      classification: 'preview',
      envName: `pr${previewMatch[1]}`,
      prNumber: parseInt(previewMatch[1]),
    };
  }

  // Sandbox environments – '-sand-' or '-sandbox-'
  const sandboxMatch = name.match(/-(sand|sandbox)-/);
  if (sandboxMatch) {
    return {
      classification: 'sandbox',
      envName: sandboxMatch[1],
    };
  }

  // Production environments – '-prod-' or '-production-'
  const prodMatch = name.match(/-(prod|production)-/);
  if (prodMatch) {
    return {
      classification: 'production',
      envName: prodMatch[1],
    };
  }

  // Nothing matched
  return { classification: null, envName: null };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
