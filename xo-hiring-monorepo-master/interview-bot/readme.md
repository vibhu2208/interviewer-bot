# Interview Bot (XO Assessments)

## Knowledge Base

### Data Protection in GQL API

Reasoning: We have two access modes to our data:

- From candidate: requests minimal set of information, enough for passing the assessment
- From manager: requests full output that includes internal information such as perfect expected answer, grading approach, cheating detection, etc

We want to prevent candidate's access to the private information, but we don't use normal authentication mechanisms
(i.e. cognito) and we re-use the same frontend application for both candidate and manager.

#### Implementation details

1. When session is **graded** we store UUID `secretKey` on `SESSION` entity
2. We provide the secret key as a part of the link to access grading details: `https://assessments.crossover.com/grading-report?sessionId=<session.id>&detailed=true&secretKey=<session.secretKey`
3. The frontend app will provide this secret key as either an optional argument to `Query.getSessionById()`, or in the `ib-secret-key` header
4. We check the provided secret key in the AppSync resolvers and remove `Protected` fields from the output if it does not match 5. Check [data-protection.ts](./graphql-resolvers/src/utils/data-protection.ts) for configuration 6. [Query.getSessionById.ts](./graphql-resolvers/src/resolvers/Query.getSessionById.ts) protects the `Session` object 7. Because it's an entrypoint to the data, we inject `secretKey` as part of the internal `Session` object, to `secretKey` to the children resolvers if provided via parameter 8. [Session.questions.ts](./graphql-resolvers/src/resolvers/Session.questions.ts) protects the `Question` object
