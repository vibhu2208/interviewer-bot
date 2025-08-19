# Interview Bot Evaluator

This package contains the automated test harness for measuring and validating the quality of the AI-powered Interview Bot.

## Goal

The primary goal of this evaluator is to provide a consistent, objective, and automated way to assess the Interview Bot's performance.

## Approach

The test harness operates in two distinct modes:

1.  **Persona Validation**: A workflow focused on crafting and refining candidate personas. It uses an "Persona Adherence Judge" (an LLM) to score how well a Candidate LLM is following its instructions, allowing us to build a library of reliable personas.

```bash
npm run evaluate:persona
```

2.  **Bot Evaluation**: The primary CI/CD workflow. This mode uses a pre-validated persona to conduct an end-to-end interview with the Interview Bot. It then uses a "Grading Accuracy Judge" (an LLM) to evaluate the quality of the bot's final grade and summary.

```bash
npm run evaluate:bot
```

## How It Works

The evaluator simulates a real user by:

- Acting as a client to programmatically call the Interview Bot's APIs to start and conduct an interview.
- Using a stateful **Candidate LLM** to play the role of a specific candidate persona during the interview.
- Using **LLM-as-Judge** evaluators to score the outcome of the simulation.
- Generating a comprehensive JSON report containing the full transcript, the bot's grade, and the judges' evaluations.

## Prerequisites

- Node.js (v18 or higher)
- Access to the Crossover sandbox environment

---
