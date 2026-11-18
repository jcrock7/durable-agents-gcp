# ADR-0005: LiteLLM proxy as the LLM gateway (routing and cost tracking)

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

We need one place to: route requests across models (primary/fallback, cheap/smart tiers), enforce per-agent budgets and rate limits, record tokens and cost per request, and apply guardrails ([ADR-0006](0006-guardrails.md)). The solution must be open source and self-hostable on GKE.

## Decision

Deploy the **LiteLLM proxy** as a service in the cluster:
- OpenAI-compatible endpoint consumed by the agents ([ADR-0003](0003-agent-framework.md))
- Model aliases (e.g., `fast`, `smart`) mapped to Vertex models, with **fallbacks** and retries
- **Virtual keys per agent** with **budgets** and rate limits — a hard cap on demo spend
- **Spend logs** stored in the shared Postgres ([ADR-0007](0007-postgres-pgvector.md)) and shown in the UI as cost per agent run
- Only the gateway's Kubernetes service account has Vertex AI IAM permissions

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Portkey gateway (OSS) | TypeScript-native with built-in guardrails, but the open-source edition has weaker budget/spend tracking |
| Envoy AI Gateway / GKE Inference Gateway | Kubernetes-native and a strong GKE signal, but aimed at self-hosted model serving more than managed APIs |
| Routing in app code | Every agent re-implements fallbacks, budgets and cost tracking; no central control |
| Vertex AI directly + Cloud Billing reports | Billing is delayed and not broken down per agent run |

## Consequences

- **Positive:** One service covers routing and cost tracking; agents hold no provider credentials; per-agent budgets protect the demo budget.
- **Negative / risks:** Python service in a TypeScript stack (acceptable as a separate container). The gateway sits on the path to all model spend — **pin the container image by digest**, review releases before upgrading, and keep its master key in Secret Manager.
- **Revisit when:** Self-hosted models are introduced (consider Envoy AI Gateway / GKE Inference Gateway in front of them).
