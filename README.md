# XO Hiring Monorepo

## Overview
This is a comprehensive monorepo for the XO Hiring platform built using AWS CDK (Cloud Development Kit). The project contains multiple microservices and components that work together to provide a complete hiring solution.

## Project Structure

### Core Components
- **api-proxy**: API Gateway for Salesforce API integration
- **terminated-partners**: Service for managing terminated partner accounts
- **sf-api**: Salesforce API integration services
- **sf-updater**: Updates Salesforce records
- **sf-process-raw-applications**: Processes raw application data from Salesforce
- **sf-exceptions-proxy**: Handles exceptions in Salesforce integrations
- **sandbox-refresh**: Tools for refreshing sandbox environments
- **site-recacher**: Service for recaching site data
- **stats-tracker**: Analytics and statistics tracking tools

### AI and Interview Tools
- **xo-ai-coach**: AI coaching tools for interviews
- **interview-bot**: Automated interview systems
- **grading-bot**: Tools for grading interview responses

### Utility Services
- **bfq-verification**: Verification systems
- **cometd**: Real-time data streaming
- **s3-cleanup**: AWS S3 bucket cleanup utilities
- **s3-csv-split**: Tools for splitting CSV files in S3
- **uploadavatar**: Service for avatar upload functionality
- **watcher**: Monitoring and observability tools

## Getting Started

### Prerequisites
- Node.js and npm
- AWS CLI configured with appropriate credentials
- Understanding of AWS CDK (Cloud Development Kit)

### AWS CDK Resources
If you're new to AWS CDK, please familiarize yourself with it using these resources:
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
- [Building the versatile deployment system with AWS CDK](https://ws-lambda.atlassian.net/wiki/spaces/LAMBDA/pages/1908604929/Building+the+versatile+deployment+system+with+AWS+CDK)
- [General CDK Information](https://ws-lambda.atlassian.net/wiki/spaces/LAMBDA/pages/1964441601/CDK)

### Setup
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. For Windows users, use `cli.bat` for CLI commands
4. For Unix/Linux/Mac users, use `cli.sh` for CLI commands

## Development

### Code Standards
This project uses:
- TypeScript (ES2022)
- ESLint for linting
- Prettier for code formatting

To run linting and formatting checks:
```bash
npm run eslint:lint-all    # Check for linting issues
npm run prettier:check-all  # Check formatting
npm run prettier:fix-all    # Fix formatting issues
```

### Environment Configuration
Environment configurations are defined in `deploy/src/config/environments.ts`.

There are three main environments:
- **Production**: Production environment configuration
- **Sandbox**: Development environment configuration
- **Preview**: Deployed for pull requests

**Important**: If you add a new environment variable, make sure to add it to all environment configurations.
## System Workflow

Simple textual flow (no special renderers required):

1. Candidate starts a session via the Interview app.
2. Frontend calls AppSync GraphQL (schema: `interview-bot/schema.graphql`).
3. Resolvers (`interview-bot/graphql-resolvers/src/resolvers/*`) read/write DynamoDB.
4. Candidate answers questions; subscription sends real-time updates.
5. Candidate marks session completed; resolver updates `state=Completed`, sets `endTime`.
6. Grading-bot (`grading-bot/src/*`) runs, writes results + `secretKey`, sets `state=Graded`.
7. Manager views report using `secretKey`; resolvers hide Protected fields without it.
8. Salesforce sync via `api-proxy/` and `sf-*` services.

ASCII overview diagram:

```
Candidate FE
    |
    v
AWS AppSync (GraphQL)
    |
    v
Resolvers (Lambdas)
  - interview-bot/graphql-resolvers/src/resolvers/*
    |
    v
DynamoDB (Sessions/Questions)
    ^                          
    |  (read/write)            
    |                          
Grading-bot (grading-bot/src/*)
    |
    v
Save grading + secretKey, set state=Graded
    |
    v
api-proxy/ + sf-*  --->  Salesforce

Manager FE --(secretKey)--> AppSync --> Resolvers --> Filtered/Full data
```
### Why Salesforce is used

- **System of record for hiring**: Centralizes Candidates/Contacts, Jobs/Opportunities, Applications, Interviews.
- **Native automation & workflows**: Assignment, notifications, SLAs, approvals triggered from synced results.
- **Reporting & analytics**: Funnels, cohort performance, drop-off, quality metrics in a single place.
- **Ecosystem integrations**: Offers, onboarding, billing, ops tools already connected to Salesforce.

Related services in this repo:
- Gateways/Proxies: `api-proxy/`
- Salesforce services: `sf-api/`, `sf-updater/`, `sf-process-raw-applications/`, `sf-exceptions-proxy/`
- Ops analytics: `stats-tracker/`

### Detailed end-to-end workflow

1) Candidate starts session via Interview app → GraphQL (`interview-bot/schema.graphql`).
2) Resolvers in `interview-bot/graphql-resolvers/src/resolvers/*` read/write DynamoDB (Sessions/Questions).
3) Candidate answers → mutations store responses; subscription pushes real-time updates.
4) `Mutation.markSessionAsCompleted` (`.../Mutation.markSessionAsCompleted.ts`) sets `state=Completed`, `endTime=now` using `getSessionKey()` and `util.dynamodb.toMapValues(...)`.
5) `grading-bot/` consumes responses, applies LLM/domain logic (`packages/*`), writes results + `secretKey`, sets `state=Graded`.
6) Manager queries with `secretKey` → resolvers apply `graphql-resolvers/src/utils/data-protection.ts` to hide Protected fields when key is missing/invalid.
7) Results sync via `api-proxy/`, `sf-api/`, `sf-updater/`, `sf-process-raw-applications/` to Salesforce; exceptions via `sf-exceptions-proxy/`.
8) Infra uses CDK stacks in `deploy/src/deployments/*` (config: `deploy/src/config/*`) across Prod/Sandbox/Preview.

### Why resolvers and other components

- **Resolvers (AppSync)**: Implement per-field logic with `request(ctx)`/`response(ctx)`, validate inputs, access data sources (DynamoDB), and enforce security. Examples:
  - `Query.getSessionById.ts`, `Session.questions.ts` → fetch + protect fields
  - `Mutation.markSessionAsCompleted.ts` → transition to Completed
- **DynamoDB**: Low-latency store for sessions/questions; fits single-table access patterns.
- **AppSync GraphQL**: Strongly typed API with subscriptions and auth; clean client contract.
- **grading-bot**: Decouples heavy/async scoring from request path; uses shared logic from `packages/*`.
- **Salesforce services**: Boundary for CRM; handle retries, mapping, security (no direct DB writes).
- **Data protection utils**: Prevent leak of ideal answers/rubrics; manager-only via `secretKey`.
- **CDK stacks**: Repeatable infra-as-code with preview envs on PRs.
## Deployment

### Deployment Process
For detailed deployment information, refer to: [Deployment process with CDK](https://ws-lambda.atlassian.net/wiki/spaces/LAMBDA/pages/1866006529/Deployment+process+with+CDK)

### Key Points
- Opening a PR (even a draft) will trigger deployment to a "staging" environment
- Lambda configurations are located in `deploy/src/deployments/[service-name]`
- Each service's infrastructure is defined as AWS CDK stacks

## Infrastructure

The services are deployed on AWS with the following resources:
- Lambda functions
- API Gateway
- VPC configurations
- Security groups
- CloudWatch events
- S3 buckets
- DynamoDB tables

## Additional Resources

- The `docs` directory contains additional documentation
- The `diagrams` directory contains architectural diagrams

## Troubleshooting

If you encounter issues with deployment or configuration:
1. Verify your AWS credentials are correctly set up
2. Check the CloudWatch logs for the relevant Lambda function
3. Verify environment configurations in `deploy/src/config/environments.ts`
4. Ensure all dependencies are properly installed

## Contributing

1. Create a feature branch from main
2. Make your changes following the code standards
3. Open a pull request
4. Address any review comments
5. Once approved, your changes will be merged and deployed
