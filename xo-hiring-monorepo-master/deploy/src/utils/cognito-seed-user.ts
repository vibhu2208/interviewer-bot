import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  UserNotFoundException,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';

/**
 * Interface representing a Cognito user configuration
 */
export interface CognitoUserConfig {
  username: string;
  password: string;
  groupName: string;
}

/**
 * Synchronizes users with the Cognito user pool using AWS SDK v3
 * Creates users if they don't exist, sets their passwords, and adds them to groups
 * All operations are handled under a single try-catch block
 *
 * @param region - AWS region where the Cognito user pool is located
 * @param userPoolId - The ID of the Cognito user pool
 * @param users - Array of user configurations
 * @returns Promise that resolves when all users are synchronized
 */
export async function syncCognitoUsers(userPoolId: string, users: CognitoUserConfig[]): Promise<void> {
  // Create a new CognitoIdentityProviderClient instance
  const client = new CognitoIdentityProviderClient();

  try {
    for (const user of users) {
      // Check if user already exists using AdminGetUser
      let userExists = false;
      try {
        const getUserCommand = new AdminGetUserCommand({
          UserPoolId: userPoolId,
          Username: user.username,
        });

        await client.send(getUserCommand);
        userExists = true;
        console.log(`User ${user.username} already exists.`);
      } catch (error) {
        // If the error is UserNotFoundException, the user doesn't exist
        if (error instanceof UserNotFoundException) {
          userExists = false;
          console.log(`User ${user.username} does not exist.`);
        } else {
          // Rethrow any other errors
          throw error;
        }
      }

      if (userExists) {
        continue;
      }

      console.log(`Creating user ${user.username}...`);

      const createCommand = new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: user.username,
        MessageAction: MessageActionType.SUPPRESS,
        TemporaryPassword: user.password,
        ValidationData: [
          {
            Name: 'SkipValidation',
            Value: 'true',
          },
          {
            Name: 'AutoConfirm',
            Value: 'true',
          },
        ],
      });

      await client.send(createCommand);
      console.log(`User ${user.username} created successfully.`);

      // Set permanent password
      console.log(`Setting password for user ${user.username}...`);

      const passwordCommand = new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: user.username,
        Password: user.password,
        Permanent: true,
      });

      await client.send(passwordCommand);
      console.log(`Password set for user ${user.username}.`);

      // Add user to group if specified
      if (user.groupName) {
        console.log(`Adding user ${user.username} to group ${user.groupName}...`);

        const groupCommand = new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          GroupName: user.groupName,
        });

        await client.send(groupCommand);
        console.log(`User ${user.username} added to group ${user.groupName}.`);
      }
    }

    console.log('User synchronization completed successfully.');
  } catch (error) {
    console.error('Error synchronizing users:', error);
    throw error;
  }
}
