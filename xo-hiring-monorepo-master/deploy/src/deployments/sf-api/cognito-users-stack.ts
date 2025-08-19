import { StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { CfnUserPoolGroup } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface CognitoUsersStackProps extends NestedStackProps {
  config: StackConfig;
  userPoolId: string;
  groups: string[];
}

export class CognitoUsersStack extends NestedStack {
  constructor(scope: Construct, id: string, props: CognitoUsersStackProps) {
    super(scope, id, props);

    // create groups
    const groups = new Map(
      [...new Set(props.groups)].map((groupName) => [
        groupName,
        new CfnUserPoolGroup(this, `group-${groupName}`, {
          userPoolId: props.userPoolId,
          groupName: groupName,
        }),
      ]),
    );
  }
}
