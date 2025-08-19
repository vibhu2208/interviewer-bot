import * as route53 from 'aws-cdk-lib/aws-route53';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import { IDistribution } from 'aws-cdk-lib/aws-cloudfront';
import { Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DnsConfig } from '../config/model';

export function getDistributionDnsProps(scope: Construct, dnsConfig: DnsConfig | undefined) {
  return {
    certificate: dnsConfig
      ? certificatemanager.Certificate.fromCertificateArn(scope, 'certificate', dnsConfig.viewerCertificateArn)
      : undefined,
    domainNames: dnsConfig ? [dnsConfig.cnameRecordName] : undefined,
  };
}

export function defineDNSRecords(
  scope: Construct,
  dnsConfig: DnsConfig | undefined,
  distribution: IDistribution,
): void {
  if (!dnsConfig) {
    return;
  }

  const zone = route53.HostedZone.fromHostedZoneAttributes(scope, 'zone', {
    hostedZoneId: dnsConfig.hostedZoneId,
    zoneName: dnsConfig.hostedZoneName,
  });

  new route53.CnameRecord(scope, `dnsrecord`, {
    zone: zone,
    recordName: dnsConfig.cnameRecordName,
    ttl: Duration.seconds(dnsConfig.ttlSec),
    domainName: distribution.distributionDomainName,
  });

  new CfnOutput(scope, `URL`, {
    value: `https://${dnsConfig.cnameRecordName}`,
  });
}
