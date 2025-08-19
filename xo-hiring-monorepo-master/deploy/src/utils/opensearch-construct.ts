import { Construct } from 'constructs';
import { CfnOutput } from 'aws-cdk-lib';
import { aws_opensearchserverless as oss } from 'aws-cdk-lib';
import { StackConfig } from '@trilogy-group/lambda-cdk-infra';
import * as lambda from 'aws-cdk-lib/aws-lambda';

interface OpenSearchConstructProps {
  config: StackConfig;
  name: string;
  type: 'SEARCH' | 'TIMESERIES' | 'VECTORSEARCH';
}

export class OpenSearchConstruct extends Construct {
  private readonly props: OpenSearchConstructProps;
  private readonly collectionName: string;
  public readonly collectionEndpoint: string;

  constructor(scope: Construct, id: string, props: OpenSearchConstructProps) {
    super(scope, id);
    this.props = props;

    this.collectionName = this.generateName(props.name);

    // See https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-manage.html
    const collection = new oss.CfnCollection(this, props.name, {
      name: this.collectionName,
      description: '-',
      type: props.type,
    });

    // Encryption policy is needed in order for the collection to be created
    const encryptionPolicy = new oss.CfnSecurityPolicy(this, `${props.name}-encryption`, {
      name: this.generateName(`${props.name}-encryption`),
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${this.collectionName}`],
          },
        ],
        AWSOwnedKey: true,
      }),
      type: 'encryption',
    });
    collection.addDependency(encryptionPolicy);

    // Network policy is required so that the dashboard can be viewed
    const networkPolicy = new oss.CfnSecurityPolicy(this, `${props.name}-network`, {
      name: this.generateName(`${props.name}-network`),
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${this.collectionName}`],
            },
            {
              ResourceType: 'dashboard',
              Resource: [`collection/${this.collectionName}`],
            },
          ],
          AllowFromPublic: true,
        },
      ]),
      type: 'network',
    });
    collection.addDependency(networkPolicy);

    this.collectionEndpoint = collection.attrCollectionEndpoint;

    new CfnOutput(this, 'CollectionEndpoint', {
      value: collection.attrCollectionEndpoint,
    });
    new CfnOutput(this, 'DashboardEndpoint', {
      value: collection.attrDashboardEndpoint,
    });
  }

  public dataAccessPolicy(id: string, func: lambda.Function): oss.CfnAccessPolicy {
    // Data access policy is required so that data can be accessed
    return new oss.CfnAccessPolicy(this, `${id}-data`, {
      name: this.generateName(`${id}-data`),
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'index',
              Resource: [`index/${this.collectionName}/*`],
              Permission: ['aoss:*'],
            },
            {
              ResourceType: 'collection',
              Resource: [`collection/${this.collectionName}`],
              Permission: ['aoss:*'],
            },
          ],
          Principal: [`${func.role?.roleArn}`],
        },
      ]),
      type: 'data',
    });
  }

  private generateName(resourceName: string): string {
    return this.props.config.generateName(resourceName).substring(0, 32);
  }
}
