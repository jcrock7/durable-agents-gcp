# ADR-0002: Temporal as the durable runtime for agents

- **Status:** Accepted — GKE deployment superseded by [ADR-0011](0011-temporal-single-pod.md) (single dev-server pod)
- **Date:** 2026-11-17

## Context

Agent runs are long, multi-step, and call unreliable things (LLMs, tools, external APIs). A plain request/response loop loses progress on pod restarts, timeouts, or rate limits, and can't easily pause for human approval. Showing durable, recoverable agents is a strong differentiator in demos.

## Decision

Run each agent as a **Temporal workflow** (TypeScript SDK). LLM calls and tool calls are **activities** with retry policies and timeouts. Human-in-the-loop steps use **signals**; progress is exposed with **queries**.

- **Local:** `temporal server start-dev` (single binary, built-in UI)
- **GKE:** official Temporal Helm chart, persistence in the shared Postgres ([ADR-0007](0007-postgres-pgvector.md)), no Elasticsearch (standard visibility only)

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Temporal Cloud | Least ops, but ongoing cost and hides the Kubernetes work the demos are meant to show |
| Framework-native durability (LangGraph checkpoints, Mastra workflows) | Ties durability to one agent framework; weaker retries, history and visibility than Temporal |
| Queue + workers (Pub/Sub, BullMQ) | Must hand-build state, retries, timers and replay — exactly what Temporal provides |
| Cloud Workflows | Managed and GCP-native, but YAML-based and a poor fit for code-heavy agent logic |

## Consequences

- **Positive:** Demonstrable: kill a worker pod mid-run and watch the agent resume; full event history for debugging; approval steps are trivial.
- **Negative / risks:** Self-hosted Temporal adds several pods (frontend, history, matching, worker, UI). Workflow code must be deterministic — LLM calls must live in activities, never in workflow code.
- **Revisit when:** Cluster cost or ops time from Temporal dominates; consider Temporal Cloud for a long-running public demo.
