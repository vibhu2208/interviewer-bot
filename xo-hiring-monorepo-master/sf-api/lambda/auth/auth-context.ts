import * as AWS from 'aws-sdk';
import { APIGatewayProxyEvent } from 'aws-lambda/trigger/api-gateway-proxy';
import { InitiateAuthResponse, UserType } from 'aws-sdk/clients/cognitoidentityserviceprovider';
import { AuthScenario, RequestBody } from './common';

export type AuthenticateUserResult =
  | 'UserNotFound'
  | 'UserNotConfirmed'
  | 'AuthorizationError'
  | 'UnexpectedError'
  | 'Success';

export class AuthContext {
  event: APIGatewayProxyEvent;
  payload: RequestBody;
  scenario: AuthScenario;
  cognitoIdSp: AWS.CognitoIdentityServiceProvider;
  user: UserType;
  authResponse: InitiateAuthResponse;

  constructor(event: APIGatewayProxyEvent) {
    event.body = event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString()
        : event.body
      : null;
    event.isBase64Encoded = false;

    this.event = event;
    this.payload = event.body ? JSON.parse(event.body) : null;
    this.scenario = this.payload?.scenario;
    if (this.payload?.email) {
      this.payload.email = this.payload.email.toLowerCase();
    }
    this.cognitoIdSp = new AWS.CognitoIdentityServiceProvider();
  }

  async findUserByEmail(): Promise<void> {
    const listUsersResponse = await this.cognitoIdSp
      .listUsers({
        UserPoolId: process.env.USER_POOL_ID,
        Filter: `email="${this.payload?.email}"`,
        Limit: 1,
      })
      .promise();

    if (listUsersResponse.Users.length === 1) {
      this.user = listUsersResponse.Users[0];
    } else {
      this.user = null;
    }
  }

  async authenticateUser(): Promise<AuthenticateUserResult> {
    if (!this.user) {
      await this.findUserByEmail();
    }

    if (!this.user) {
      return 'UserNotFound';
    } else {
      if (!this.isUserConfirmed()) {
        return 'UserNotConfirmed';
      }
      try {
        this.authResponse = await this.cognitoIdSp
          .initiateAuth({
            AuthParameters: {
              USERNAME: this.user.Username,
              PASSWORD: this.payload?.password,
            },
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: process.env.CLIENT_ID,
          })
          .promise();
        return 'Success';
      } catch (err) {
        console.log(`Auth context: ${JSON.stringify(this)}`);
        console.error(err);

        if (err.code === 'UserNotFoundException') {
          return 'UserNotFound';
        } else if (err.code === 'UserNotConfirmedException') {
          return 'UserNotConfirmed';
        } else if (err.code === 'NotAuthorizedException') {
          return 'AuthorizationError';
        } else {
          return 'UnexpectedError';
        }
      }
    }
  }

  isUserConfirmed(): boolean {
    return this.user?.UserStatus === 'CONFIRMED';
  }

  isUserEmailVerified(): boolean {
    return getUserAttribute(this.user, 'email_verified') === 'true';
  }
}

const getUserAttribute = function (user: UserType, name: string): string {
  let value: string;
  user?.Attributes.forEach((attribute) => {
    if (attribute.Name === name) {
      value = attribute.Value;
    }
  });
  return value;
};
