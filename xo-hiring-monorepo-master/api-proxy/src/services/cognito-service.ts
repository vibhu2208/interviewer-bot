import {
  CognitoIdentityProviderClient,
  UserType,
  AdminGetUserCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';

export const DEFAULT_PHONE_NUMBER = '+12000000000';

export class CognitoService {
  private readonly cognito: CognitoIdentityProviderClient;

  constructor(private readonly userPoolId: string) {
    this.cognito = new CognitoIdentityProviderClient();
  }

  public async getUser(username: string): Promise<UserType | null> {
    try {
      const getUserCommandOutput = await this.cognito.send(
        new AdminGetUserCommand({
          Username: username,
          UserPoolId: this.userPoolId,
        }),
      );
      return getUserCommandOutput ?? null;
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        return null;
      }
      throw error;
    }
  }
}
