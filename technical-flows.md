# Technical Flows (Text-Only)

Plain-text workflows describing how the system operates, with references to key files/paths.

- GraphQL schema: `interview-bot/schema.graphql`
- Resolvers: `interview-bot/graphql-resolvers/src/resolvers/*`
- Data protection: `interview-bot/graphql-resolvers/src/utils/data-protection.ts`
- Grading: `grading-bot/src/*`, shared logic in `packages/*`
- Salesforce services: `api-proxy/`, `sf-api/`, `sf-updater/`, `sf-process-raw-applications/`, `sf-exceptions-proxy/`
- Infra/CDK: `deploy/src/deployments/*`, config in `deploy/src/config/*`

---

## 1) Session Lifecycle (Start → Complete → Graded)

- Client calls GraphQL (AppSync) per `interview-bot/schema.graphql`.
- `Query.getSessionById` resolves Session and returns dynamic fields (e.g., `questions`) via resolvers in `.../graphql-resolvers/src/resolvers/*`.
- Session states (`SessionState` in schema): `Initializing → Ready → Started → Completed → Graded`.
- Completion is driven by `Mutation.markSessionAsCompleted(sessionId)`.
  - Resolver file: `interview-bot/graphql-resolvers/src/resolvers/Mutation.markSessionAsCompleted.ts`.
  - request(ctx): builds DynamoDB UpdateItem with `state='Completed'` and `endTime=util.time.nowISO8601()`; uses `getSessionKey()` and `util.dynamodb.toMapValues(...)`.

---

## 2) Question Delivery & Answer Handling

- Client fetches current Session with `questions` (field resolved under `.../resolvers/Session.questions.ts`).
- To answer:
  - `Mutation.setQuestionAnswer(sessionId, questionId, answer): Boolean` (simple write), or
  - `Mutation.attemptAnswer(sessionId, questionId, answer): OperationResult!` (validations + result envelope).
- Resolvers write to DynamoDB using AppSync utilities (`util.dynamodb.*`).
- On successful attempt, the system triggers an internal mutation `triggerAnswerAttempted` (restricted by `@aws_iam`) to fan out `Subscription.answerAttempted` updates.
  - Subscription wiring is declared in `schema.graphql` via `@aws_subscribe(mutations: ["triggerAnswerAttempted"])`.

---

## 3) Mark Session Completed (Unblocks Grading)

- Client calls `Mutation.markSessionAsCompleted(sessionId)`.
- Resolver updates the Session item in DynamoDB:
  - Sets `state = 'Completed'`.
  - Sets `endTime = nowISO8601()`.
- Outcome: signals downstream graders to start.

---

## 4) Automated Grading Pipeline

- Service: `grading-bot/src/*` (tests in `grading-bot/test/*`; build via `grading-bot/build.ts`).
- May use LLMs and domain logic; shared code lives in `packages/*` (e.g., `packages/beginner-mind-grader/`, `packages/interview-assist/`).
- Reads stored responses from DynamoDB, computes grading, and writes:
  - Grading results back to Session/Question records.
  - A `secretKey` onto the Session for secure manager access.
  - Session `state` transitions to `Graded`.

---

## 5) Secure Reporting & Field-Level Protection

- Manager UI requests details with `secretKey` (e.g., `.../grading-report?sessionId=...&secretKey=...&detailed=true`).
- Resolvers enforce protection:
  - `interview-bot/graphql-resolvers/src/utils/data-protection.ts` filters Protected fields if key is missing/invalid.
  - Protected examples (per `schema.graphql`): `Question.perfectAnswer`, `Question.gradingRubric`, `Question.cheating*`, `Session.grading`, `Session.sessionEvents`, etc.
- Candidate view (no key) hides Protected fields; Manager view (valid key) shows full details.

---

## 6) Subscriptions (Real-Time Updates)

- Client subscribes to `Subscription.answerAttempted(sessionId, questionId)`.
- Flow:
  - Client invokes answer mutation.
  - Resolver writes to DB → triggers `triggerAnswerAttempted`.
  - AppSync delivers `AnswerAttemptResult` to subscribers (status, attempts, validity, state).

---

## 7) Salesforce Synchronization

- After grading, outcomes are synced to Salesforce via services:
  - Gateway/Orchestration: `api-proxy/`.
  - Core SF integrations: `sf-api/`, `sf-updater/`, `sf-process-raw-applications/`.
  - Error handling: `sf-exceptions-proxy/`.
- Typical objects updated: Candidate/Contact/Lead, Opportunity/Job, Application, Interview/Assessment results.
- Benefits: workflow automation, reporting, and downstream integrations live in Salesforce.

---

## 8) Operations & Utilities

- Supporting services: `stats-tracker/`, `site-recacher/`, `sandbox-refresh/`, `s3-cleanup/`, `s3-csv-split/`, `terminated-partners/`, `watcher/`.
- Purposes include analytics, cache warming, environment maintenance, bulk processing, and housekeeping.

---

## 9) Infrastructure & Environments

- Provisioned with AWS CDK stacks under `deploy/src/deployments/*`.
- Environment configs in `deploy/src/config/*`.
- Environments:
  - Production, Sandbox, Preview (PR-triggered preview deployments).
- Core AWS resources: AppSync, Lambda, DynamoDB, S3, CloudWatch, VPC.

---

## 10) Authentication & Access Control (High-Level)

- AppSync auth modes per schema directives (e.g., `@aws_iam` on `AnswerAttemptResult`).
- Resolver-level checks and masking via `data-protection.ts`.
- `secretKey` mechanism enables manager-only access to Protected fields.

---

## 11) Error Handling & Observability (High-Level)

- Validation in resolvers (returning `OperationResult` error for attempt failures).
- Logs/metrics emitted by Lambdas (CloudWatch).
- SF exception routing through `sf-exceptions-proxy/`.

---

## 12) Key Files & Their Roles (Quick Map)

- GraphQL schema: `interview-bot/schema.graphql`
- Example resolver (completion): `interview-bot/graphql-resolvers/src/resolvers/Mutation.markSessionAsCompleted.ts`
- Data protection: `interview-bot/graphql-resolvers/src/utils/data-protection.ts`
- Grading services: `grading-bot/src/*` and tests `grading-bot/test/*`
- SF integration: `api-proxy/`, `sf-api/`, `sf-updater/`, `sf-process-raw-applications/`, `sf-exceptions-proxy/`
- CDK stacks/configs: `deploy/src/deployments/*`, `deploy/src/config/*`

---

## 13) Textual Sequence (Compact)

1. Candidate FE → AppSync GraphQL (per `schema.graphql`).
2. AppSync → Resolvers (`.../graphql-resolvers/src/resolvers/*`).
3. Resolvers ↔ DynamoDB (Sessions/Questions).
4. Candidate completes → `markSessionAsCompleted` → set `state=Completed`, `endTime=now`.
5. Grading-bot reads → computes → writes grading + `secretKey` → set `state=Graded`.
6. Manager (with `secretKey`) → GraphQL → resolvers apply data protection → detailed report.
7. Results → `api-proxy/` + `sf-*` → Salesforce.
8. Ops tools run as needed (`stats-tracker/`, `site-recacher/`, etc.).
