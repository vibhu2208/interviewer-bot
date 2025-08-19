# Quality Bar

The quality bar rules applicable to this repository.
The rules are defined in the following format:

```
- **Category** (Code): Rule
```

## Rules

- **CDK** (CDK-002): Environment-specific resources use a Destroy RemovalPolicy for non-prod environments.
  - Only applicable to the AWS CDK Constructs that support the `removalPolicy` property.
- **Implementation** (IMPL-004): Implementation does not include hardcoded or unencrypted secrets.
  - The code should not directly contain any secrets, such as API keys, passwords, or other sensitive information.
  - It is allowed to use environment variables, AWS Secrets Manager, or AWS Parameters Store to store and access secrets.
- **Implementation** (IMPL-008): Not-nullable types are used for array elements.
  - There is no requirement to validate the array in the runtime, or explicitly ensure the state of the array.
- **Implementation** (IMPL-009): Return empty arrays instead of null if the function is expected to return empty collections.
  - Only applicable when the function is normally expected to return an array or collection.
  -
