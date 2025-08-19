# Interview System Flow Diagrams

This document contains visual diagrams of the interview system, grounded to the repository paths and components.

- Schema: `interview-bot/schema.graphql`
- Resolvers: `interview-bot/graphql-resolvers/src/resolvers/*`
- Data protection: `interview-bot/graphql-resolvers/src/utils/data-protection.ts`
- Grading: `grading-bot/src/*`, shared: `packages/*`
- Deploy stacks: `deploy/src/deployments/*`, config: `deploy/src/config/*`

## System Architecture

```mermaid
flowchart LR
  subgraph FE[Candidate/Manager Frontends]
    FE1[Interview App (Candidate)]
    FE2[Manager App]
  end

  FE1 -->|GraphQL queries/mutations| APPSYNC[(AWS AppSync GraphQL)]
  FE2 -->|GraphQL queries with secretKey| APPSYNC

  subgraph RES[GraphQL Resolvers (Lambda)]
    R1[Query/Mutation Resolvers\ninterview-bot/graphql-resolvers/src/resolvers/*]
    DP[Field-level Data Protection\ninterview-bot/graphql-resolvers/src/utils/data-protection.ts]
  end

  APPSYNC --> R1
  R1 -->|DynamoDB API| DDB[(DynamoDB - Sessions/Questions)]
  R1 -->|Subscriptions| APPSYNC

  subgraph GRADING[Automated Grading]
    GB[grading-bot/src/*]
    PKG1[packages/beginner-mind-grader/]
    PKG2[packages/interview-assist/]
  end

  R1 <-->|read/write results, state=Graded, secretKey| GB
  GB --> PKG1
  GB --> PKG2
  GB -->|logs/metrics| CW[(CloudWatch)]

  subgraph INTEGRATIONS[Integrations & Ops]
    APIX[api-proxy/]
    SFAPI[sf-api/]
    SFUP[sf-updater/]
    SFPR[sf-process-raw-applications/]
    SFEX[sf-exceptions-proxy/]
    OPS1[stats-tracker/]
    OPS2[site-recacher/]
    OPS3[sandbox-refresh/]
    OPS4[s3-cleanup/]
    OPS5[s3-csv-split/]
    OPS6[terminated-partners/]
    OPS7[watcher/]
  end

  GB -->|graded outcomes| APIX
  APIX -->|Salesforce sync| SFAPI & SFUP & SFPR & SFEX

  subgraph INFRA[AWS CDK Stacks]
    CDK[deploy/src/deployments/*\nconfigs: deploy/src/config/*]
    S3[(S3)]
    VPC[(VPC)]
  end

  CDK --- APPSYNC
  CDK --- RES
  CDK --- DDB
  CDK --- S3
  CDK --- GRADING
  CDK --- INTEGRATIONS

  note right of APPSYNC
    Schema: interview-bot/schema.graphql\n    Enforces types, subscriptions, auth
  end

  R1 --> DP
  DP --> APPSYNC
```

## End-to-End Sequence

```mermaid
sequenceDiagram
  participant C as Candidate Frontend
  participant G as AppSync GraphQL
  participant R as GraphQL Resolvers (Lambdas)
  participant D as DynamoDB (Sessions/Questions)
  participant GB as grading-bot
  participant M as Manager Frontend
  participant SF as Salesforce Pipelines (api-proxy/sf-*)

  Note over G: Schema: interview-bot/schema.graphql

  C->>G: Mutation.setQuestionAnswer / attemptAnswer
  G->>R: Invoke resolver (validate, write)
  R->>D: Put/UpdateItem (store response)
  R-->>G: Result
  G-->>C: Response
  G->>G: triggerAnswerAttempted (IAM-protected)
  G-->>C: Subscription.answerAttempted

  C->>G: Mutation.markSessionAsCompleted(sessionId)
  G->>R: resolvers/Mutation.markSessionAsCompleted.ts
  Note over R: request(ctx) builds UpdateItem\nset #state='Completed', #endTime=nowISO8601()\ngetSessionKey() + util.dynamodb.toMapValues(...)
  R->>D: UpdateItem (state, endTime)
  R-->>G: Boolean
  G-->>C: Completed=true

  Note over GB: Async grading kicks off
  G->>GB: Event/trigger (out-of-band)
  GB->>D: Read responses
  GB->>GB: Apply LLM/rules via packages/*
  GB->>D: Write grading results, secretKey\nUpdate Session.state='Graded'

  M->>G: Query.getSessionById(sessionId, secretKey, detailed=true)
  G->>R: Resolve session + questions
  R->>R: data-protection.ts hides Protected fields if no/invalid secretKey
  R->>D: Read session/questions
  R-->>G: Filtered/Full view based on secretKey
  G-->>M: Grading report

  GB->>SF: Push outcomes via api-proxy/sf-*
  SF-->>GB: Ack/Status
```
