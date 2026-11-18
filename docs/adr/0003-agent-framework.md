# ADR-0003: Vercel AI SDK for agent logic, inside Temporal activities

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

Agents need tool calling, structured output and streaming. Temporal ([ADR-0002](0002-temporal-durable-runtime.md)) already owns orchestration, retries and state, so the agent library should be thin and not bring a second orchestration layer.

## Decision

Use the **Vercel AI SDK** (`ai` package) for model calls, tool definitions, structured output (Zod) and streaming. Each model/tool step runs in a Temporal activity. Model traffic goes through the LiteLLM gateway's OpenAI-compatible endpoint ([ADR-0005](0005-llm-gateway-litellm.md)), so agent code never holds provider credentials.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Google ADK (TypeScript) | Strongest "Google" signal, but more opinionated, and its runner/session model overlaps with Temporal. Good candidate for one dedicated prototype |
| LangGraph.js | Graph runtime and checkpointing duplicate Temporal |
| Mastra | Built-in workflows and memory duplicate Temporal and Postgres |
| Hand-rolled loop on the raw API | More code to maintain for tool calling, schema validation and streaming |

## Consequences

- **Positive:** Small, readable agent code; easy to swap models; clear split — Temporal = durability, AI SDK = model interaction.
- **Negative / risks:** Fewer built-in agent patterns (memory, multi-agent) — these are built explicitly as Temporal workflows, which is more code but easier to explain.
- **Revisit when:** A prototype is specifically about Google's agent ecosystem (use ADK there).
