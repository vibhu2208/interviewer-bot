# Integration Library

## Overview

This library provides a set of classes and functions to integrate with the different services and APIs that the product uses.

The list of the services and APIs that this library integrates with are:

- Salesforce
- AWS Parameter Store
- AWS Secrets Manager
- LLM (Language Model)
- [Interview bot](../../interview-bot/)

## Development

- Perform the changes you want to make in the library
- Run `npm run create-index` to update the index files (if required)
- Run `npm run build` to build the library
- Run `npm run test` to run the tests
- Update the version in the `package.json` file
  - For manual publishing:
    - Add `-preview.X` suffix, i.e. `1.0.0-preview.1`
    - Run `npm publish`
- Create the Pull Request

## Usage

### Environment

The library relies on `process.env.ENV` variable to determine the target environment.
As of now, we have 2 stable environments:

- `production`
- `sandbox`

And preview environments, that typically starts from `pr` prefix and deployed by GitHub Actions.

For some services we use 'sandbox' environment endpoints even for the 'preview' environments.

This library provides a set of utils to work with environments:

```typescript
import { getEnvironmentType, getStableEnvironmentName } from '@trilogy-group/xoh-integration';

const envType = getEnvironmentType(); // 'production' | 'sandbox' | 'preview', 'preview' is default

const stableEnvName = getStableEnvironmentName(); // 'production' | 'sandbox', default is 'sandbox'
```

### Salesforce

#### Overview

The integration client uses `no_reply+app@crossover.com` Salesforce User to perform the operations.
The default credentials are stored in the `/xo-hiring/${env}/common/salesforce-app-account` SSM Parameter.
The library allows to provide custom credentials for the Salesforce User.

All authenticated user's tokens are cached in the `/xo-hiring/${env}/salesforceAuthorizer/access_token` SSM Parameter.
This is done to reduce the amount of login requests to Salesforce from the service apps.

When using from the lambda, make sure it has permissions to access the SSM parameters mentioned above.

#### Usage

Get a default client

```typescript
import { Salesforce } from '@trilogy-group/xoh-integration';

const client = Salesforce.getDefaultClient();
```

Create a custom client with custom credentials

```typescript
import { Salesforce } from '@trilogy-group/xoh-integration';

const client = Salesforce.createClient({
  name: 'my-client', // Optional, will be cached during the runtime by this name (otherwise will cached as default)
  env: 'production', // Optional environment name override, default is determine based on the ENV variable.
  credentials: {
    client_id: '', // Optional, allows you to override client (managed app)
    client_secret: '', // Optional, allows you to override client (managed app)
    username: '', // Your Salesforce username.
    password: '', // Concatenation of the user's password and the user's security token.
  },
});
```

Perform a SOQL query:

```typescript
import { Salesforce } from '@trilogy-group/xoh-integration';

const client = Salesforce.getDefaultClient();

const accounts = await client.querySOQL('SELECT Id, Name FROM Account'); // Array of Account objects
```

### Secrets Manager

```typescript
import { SecretsManager } from '@trilogy-group/xoh-integration';

const stringOrNull = await SecretsManager.fetchSecret('my-secret-name');

const objOrNull = await SecretsManager.fetchJsonSecrets('my-secret-name');
```

### Parameter Store

```typescript
import { Ssm } from '@trilogy-group/xoh-integration';

const stringOrNull = await Ssm.fetchParameter('my/param/name');

const objOrNull = await Ssm.fetchParameterJson('my/param/name');
```

### LLM (Language Model)

#### Overview

The LLM utility provides a convenient way to work with various language model providers like Amazon Bedrock and OpenAI. It includes provider caching and model instance management to ensure optimal performance.

#### Peer Dependencies

The following peer dependencies are required to use the LLM functionality:

```json
{
  "ai": "^4.0.0",
  "@ai-sdk/amazon-bedrock": "^1.0.0",
  "@ai-sdk/openai": "^1.0.0"
}
```

#### Usage

Get the default model (Anthropic Claude 3 Sonnet via Amazon Bedrock):

```typescript
import { Llm } from '@trilogy-group/xoh-integration';

const model = await Llm.getDefaultModel();
```

Create a custom model instance:

```typescript
import { Llm } from '@trilogy-group/xoh-integration';

const model = await Llm.getModel({
  model: 'gpt-4',
  provider: 'openai',
  // Optional: provide custom configuration
  config: {
    apiKey: 'your-api-key',
  },
  // Optional: specify project name for configuration
  projectName: 'my-project',
});
```

The LLM utility supports two providers:

- `bedrock`: Amazon Bedrock (default)
- `openai`: OpenAI

Models are cached based on the provider, model name, and project name combination to ensure optimal performance.
