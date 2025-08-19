import {
  AdminCreateUserCommand,
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  AdminCreateUserRequest,
  ListUsersCommand,
  UserType,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export class CognitoService {
  private readonly cognito: CognitoIdentityProviderClient;

  constructor(private readonly userPoolId: string) {
    this.cognito = new CognitoIdentityProviderClient();
  }

  public async findUserByEmail(email: string): Promise<UserType | null> {
    const listUsersResponse = await this.cognito.send(
      new ListUsersCommand({
        Filter: `email="${email}"`,
        Limit: 1,
        UserPoolId: this.userPoolId,
      }),
    );
    return listUsersResponse.Users?.[0] ?? null;
  }

  public async createUser(user: Omit<AdminCreateUserRequest, 'UserPoolId'>): Promise<UserType | null> {
    const createUserResponse = await this.cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        ...user,
      }),
    );
    return createUserResponse.User ?? null;
  }

  public async setPassword(username: string, password: string): Promise<void> {
    await this.cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        Permanent: true,
        Password: password,
      }),
    );
  }

  public async linkSSOToExistingUser(options: {
    cognitoUsername: string;
    ssoProviderName: string;
    ssoProviderUserId: string;
  }): Promise<void> {
    await this.cognito.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: this.userPoolId,
        SourceUser: {
          ProviderName: options.ssoProviderName,
          ProviderAttributeName: 'Cognito_Subject',
          ProviderAttributeValue: options.ssoProviderUserId,
        },
        DestinationUser: {
          ProviderName: 'Cognito',
          ProviderAttributeValue: options.cognitoUsername,
        },
      }),
    );
  }
}
