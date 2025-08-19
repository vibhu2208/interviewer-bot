/**
 * Returns SalesForce Query endpoint, without trailing slash
 */
export const getSfQueryUrl = (sfUrl: string, apiVersion: string): string =>
  `${sfUrl}/services/data/v${apiVersion}/query`;

/**
 * Returns SalesForce API endpoint for a flow, without trailing slash
 */
export const getSfFlowUrl = (sfUrl: string, apiVersion: string, flow: string): string =>
  `${sfUrl}/services/data/v${apiVersion}/actions/custom/flow/${flow}`;
