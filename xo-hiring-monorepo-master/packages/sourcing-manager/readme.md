# Sourcing Manager

This package is responsible for managing the sourcing process of a product.
It is responsible for the following:

- Generation of the xml job feed for X (Twitter)
- Generation of the xml job feed for Indeed

## Indeed

### Feed Generator

Indeed xml feed is generated according to the [reference](https://docs.indeed.com/indeed-apply/xml-feed).

The lambda support different configuration options to customize the feed generation.
The default configuration looks like this:

```json
{
  "Currency": "LocalCode",
  "SalaryTimeUnit": "month",
  "ListAllAdsUnderCrossover": true,
  "PostCellAdsAsRemote": false,
  "PostCountryCellsAsRemote": true,
  "UseTwoLetterCountryCode": false,
  "EnableIndeedApply": true,
  "IndeedApplyResumeTag": "hidden",
  "CampaignsPerSponsoringCampaignMin": 50,
  "CampaignsPerSponsoringCampaignMax": 175
}
```

For Indeed, we not only generate the XML feed, but also group job ads into Indeed Sponsoring Campaigns.
The grouping is done by the special geographical algorithm.

After that, we generate Category tags, that are later used to create Indeed Sponsoring Campaigns.

We also update `Campaign__c.Placement__c` field in Salesforce to the JSON representation of the placement.

### Analytics Exporter

The indeed analytics is exported directly from Indeed via internal GQL API.
It is uploaded to the S3 bucket and can be access via Athena.

The Athena tables for the data have the following data model:

Analytics export - data is create via analytics exporter and uploaded to the S3 bucket.

```sql
CREATE EXTERNAL TABLE indeed_analytics (
  title STRING,
  countryFullName STRING,
  regionFullName STRING,
  city STRING,
  sumImpressions INT,
  sumClicks INT,
  sumApplyStarts INT,
  sumApplies INT,
  avgCostPerClickLocal DOUBLE,
  avgCostPerApplyStartLocal DOUBLE,
  avgCostPerApplyLocal DOUBLE,
  avgCTR DOUBLE,
  avgACR DOUBLE,
  avgASR DOUBLE,
  applyRate DOUBLE,
  sumCostLocal DOUBLE,
  jobURL STRING,
  sourceWebsite STRING,
  lastModifiedDate STRING,
  jobReferenceNumber STRING,
  firstIndexedDate STRING,
  jobCompanyName STRING,
  metadataCategory STRING,
  jobStatus STRING,
  weekNum STRING
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
LOCATION 's3://xo-hiring-production-stats-tracker-ownbackup-bucket/indeed-analytics/analytics/'
TBLPROPERTIES ("skip.header.line.count"="1")
```

Weekly publishing table - data will be created by the feed generator and uploaded to the S3 bucket.

```sql
CREATE EXTERNAL TABLE indeed_publishing (
  weekNum string,
  campaignId string,
  campaignInternalId string,
  campaignName string,
  publishingDate string,
  countryName string,
  locationName string,
  jobTitle string,
  placementLevel string,
  placementValue string,
  placementTag string,
  pipelineCode string,
  pipelineName string,
  domain string,
  compensation int,
  sourcingFrom string,
  sourcingTo string,
  cellType string,
  miningRank bigint,
  explorationRank bigint,
  conversionRank double
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
LOCATION 's3://xo-hiring-production-stats-tracker-ownbackup-bucket/indeed-analytics/publishing/'
TBLPROPERTIES ("skip.header.line.count"="1")
```

## Contribution

Every file in the `src/handlers` is a separate lambda handler.

We use `esbuild` to generate a bundle only with the code related to each entrypoint (handler).
