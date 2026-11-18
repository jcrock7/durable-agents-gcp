# ADR-0010: Edge and access — GKE Gateway API with Identity-Aware Proxy

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

Demos run on a public URL shared with others. An open endpoint lets anyone spend the Vertex AI budget or abuse the agents. Access control should need no custom auth code for prototypes.

## Decision

- **Ingress:** **GKE Gateway API** (external Application Load Balancer) with a Google-managed TLS certificate.
- **Access:** **Identity-Aware Proxy (IAP)** on the UI and API backends; grant access per demo to specific Google accounts or a Google Group, revoked afterwards.
- **Spend cap:** LiteLLM per-agent budgets ([ADR-0005](0005-llm-gateway-litellm.md)) plus a GCP billing budget with alerts.
- Internal services (Temporal, Postgres, LiteLLM, guardrails) are ClusterIP only — never exposed.
- **Local:** k3d load balancer on `localhost` with no auth.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Ingress + custom login (OAuth in the app) | More code; IAP gives Google sign-in with zero app changes |
| Cloud Armor rate limiting only | Limits abuse but doesn't restrict who can use it; can be layered on later |
| No public endpoint (screen share only) | Users can't try it themselves |

## Consequences

- **Positive:** Uses managed GCP security controls; no auth code in the prototypes; demo spend is bounded.
- **Negative / risks:** Viewers need a Google account and must be added before the demo; the load balancer and certificate take several minutes to provision after `up.sh` — start it ahead of time.
- **Revisit when:** A demo needs anonymous access — use a time-boxed link plus Cloud Armor rate limits.
