# Introduction

Beginner mind autograder is a CLI solution that has all logic required to grade the BM submissions:

- Fetching the next submission in Waiting For Grading
- Doing AI Grading
- Saving result back in SF (on manual confirmation)

# Preparation

1. Copy `.env.template` into `.env` and fill your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (this is required by vercel sdk to access Bedrock)
2. Do `npm install`

# Execution

1. Run `npm start bm-grade`
