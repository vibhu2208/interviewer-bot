const apiVersion = 'v54.0';

export const SalesforceRest = {
  query: `/services/data/${apiVersion}/query`,
  flow: `/services/data/${apiVersion}/actions/custom/flow/`,
  invocable: `/services/data/${apiVersion}/actions/custom/apex/`,
  apexrest: `/services/apexrest/`,
  sobjects: `/services/data/${apiVersion}/sobjects/`,
};
