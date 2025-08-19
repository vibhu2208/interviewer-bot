import { z } from 'zod';
import * as AWS from 'aws-sdk';

export const ServiceAccountConfigType = z
  .object({
    authEndpoint: z.string().url(),
    clientId: z.string(),
    clientSecret: z.string(),
    username: z.string(),
    password: z.string(),
    securityToken: z.string(),
  })
  .passthrough();

export type ServiceAccountConfig = z.infer<typeof ServiceAccountConfigType>;

export const ServiceAccountConfig2Type = z.intersection(
  ServiceAccountConfigType,
  z
    .object({
      vendorUsername: z.string(),
      vendorPassword: z.string(),
      vendorSecurityToken: z.string(),
    })
    .passthrough(),
);

export type ServiceAccountConfig2 = z.infer<typeof ServiceAccountConfig2Type>;

export const ActionCallerConfigType = z
  .object({
    apiSecrets: z.string(),
    gtCriteriaCallbackUrl: z.string().url(),
    salesforceUrl: z.string().url(),
  })
  .passthrough();

export type ActionCallerConfig = z.infer<typeof ActionCallerConfigType>;

export async function readConfig<T>(
  alternativeNames: string[],
  decrypt: boolean,
  configType: { parse: (d: unknown) => T },
): Promise<T> {
  console.log(`Checking '${alternativeNames.join(', ')}' parameter values.`);
  const ssm = new AWS.SSM();
  const getParametersResult = await ssm.getParameters({ Names: alternativeNames, WithDecryption: decrypt }).promise();
  for (const name of alternativeNames) {
    const parameter = getParametersResult.Parameters?.find((p) => p.Name === name && p.Value !== undefined);
    if (parameter) {
      console.log(`Selected '${name}' parameter.`);
      return configType.parse(JSON.parse(parameter.Value as string) as unknown);
    }
  }
  throw new Error('None of the requested parameters exist.');
}
