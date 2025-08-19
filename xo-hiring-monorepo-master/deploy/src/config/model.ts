export type DnsConfig = {
  viewerCertificateArn: string;
  hostedZoneId: string;
  hostedZoneName: string;
  cnameRecordName: string;
  ttlSec: number;
};

/**
 * All configuration fields should be defined here
 */
export interface EnvironmentConfiguration {
  terminatedPartners: {
    //terminatedPartners-AppConfig
    AppConfig: string;
    versionAppConfig: number;
    //TerminatedPartners-DB
    Db: string;
    versionDb: number;
    //TerminatedPartners-GoogleServiceUser
    GoogleServiceUser: string;
    versionGoogleServiceUser: number;
    resources: string[];
    vpcId: string;
    securityGroupId: string;
    subnetIds: string[];
  };
  sandboxRefreshConfig: {
    secretsKey: string;
  };
}

export interface EnvironmentWrapper {
  Current?: string;
  Config?: EnvironmentConfiguration;
}

export interface ProjectDefinition {
  name: string;
  path: string;
  stackNames?: () => Promise<string[]>;
  postDeploymentOperations?: () => Promise<void>;
}
