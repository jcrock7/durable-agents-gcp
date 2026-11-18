# ADR-0009: promptfoo for evals, gating pull requests in CI

- **Status:** Accepted — amended by [ADR-0016](0016-repository-structure.md) (evals live in `agents/<industry>/<name>/evals/`)
- **Date:** 2026-11-17

## Context

Prompt and model changes can silently break agents. LLM behavior should be tested, not just eyeballed.

## Decision

Use **promptfoo** for evals:
- Test cases per agent, in each agent's folder (`agents/<industry>/<agent>/evals/`, see ADR-0016), with deterministic assertions (JSON schema, contains, tool called) plus model-graded checks where needed
- Red-team / prompt-injection suites to exercise the guardrails ([ADR-0006](0006-guardrails.md))
- Runs in **GitHub Actions** on pull requests through the LiteLLM gateway, with its own small budget key
- CI authenticates to GCP with **Workload Identity Federation** — no stored keys

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Langfuse / Phoenix evals | Tied to deferred observability tooling ([ADR-0008](0008-observability.md)) |
| DeepEval, Ragas | Python-centric; Ragas focuses on RAG metrics — can add for a RAG prototype |
| Vertex AI Gen AI evaluation service | Managed and GCP-native; good complement, less portable |
| Custom test harness | Reinvents reporting, caching and model-graded assertions |

## Consequences

- **Positive:** Visible quality gate in the repo; red-team results are recorded alongside the code.
- **Negative / risks:** Model-graded evals cost money and can be noisy — keep CI suites small, run full suites manually.
- **Revisit when:** Eval suites outgrow CI time or budget.
