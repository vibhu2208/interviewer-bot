import { ListExecutionsCommand, ListStateMachinesCommand, SFNClient } from '@aws-sdk/client-sfn';

const client = new SFNClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

export class StepFunctions {
  static async getExecutionsCount(stateMachineName: string): Promise<number> {
    const listMachinesResponse = await client.send(new ListStateMachinesCommand());
    const stateMachine = listMachinesResponse.stateMachines?.find((it) => it.name === stateMachineName);

    if (!stateMachine) {
      return 0;
    }

    const executionsResponse = await client.send(
      new ListExecutionsCommand({
        stateMachineArn: stateMachine.stateMachineArn,
        statusFilter: 'RUNNING',
      }),
    );

    return executionsResponse.executions?.length ?? 0;
  }
}
