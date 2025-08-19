# Contribution Guidelines

This project is a mono-repo that contains multiple packages.
The language is TypeScript and the package manager is npm.
The deployment is done via AWS CDK (using the [lambda-cdk-infra](https://github.com/trilogy-group/lambda-cdk-infra) library).

## Project structure

- Every project should have its own folder in the repository root.
- There is a common 'deploy' project that contains the CDK deployments for every project (and located in the `deploy/` folder).
- Infrastructure deployment code should be part of the deploy project.
- It is normal for the deployment code to include the specific logic.

## Development

- Every project should have its own `package.json` file.
- Every project should have its own `tsconfig.json` file.
- The target Node.js version is 18.x.
- The code should be formatted using Prettier.
- The code should be linted using ESLint.
- Either `tsc` or `esbuild` can be used for the build. There is no preference between them.
- All dependencies not required during the runtime should be in the `devDependencies` section of the `package.json` file.

## Testing

- The project may not have any tests while it is a prototype.
- The deployment code (under the `deploy/` folder) is not required to be covered by tests.
- The tests should be written using Jest.
- The tests should be run using `npm run test`.
- Prefer to write unit tests over integration tests.
- Mock all external libraries and services in the tests.

## Formatting

- The code should be formatted using Prettier.
- The code should be linted using ESLint.
- The npm commands run linter and prettier are located in the root `package.json` file.
