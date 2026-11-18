# ADR-0001: TypeScript monorepo — React (Vite) UI and Node (Fastify) API

- **Status:** Accepted — amended by [ADR-0013](0013-consolidated-workloads.md) (UI served by the API)
- **Date:** 2026-11-17

## Context

Prototypes need a web UI, an API, and Temporal workers. The code is meant to be read, so one language and shared types make it easier to follow. The UI is an authenticated single-page app for demos; SEO and server rendering don't matter.

## Decision

Use a **pnpm workspace monorepo** in TypeScript:
- **UI:** React + Vite (SPA)
- **API:** Node + **Fastify**
- **Workers:** Temporal TypeScript SDK (see [ADR-0002](0002-temporal-durable-runtime.md))
- **Shared package:** request/response schemas (Zod) and types used by UI, API and workflows

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Next.js | Server rendering and routing add surface area a demo SPA doesn't need; blurs the UI/API boundary that's useful to show on Kubernetes |
| Hono | Excellent and lighter, but Fastify has more mature OpenTelemetry instrumentation and plugin ecosystem |
| NestJS | Heavier conventions; more framework than the prototypes need |
| Python backend | Splits the codebase across languages; Python is used only where it clearly wins (guardrails, [ADR-0006](0006-guardrails.md)) |

## Consequences

- **Positive:** One toolchain, end-to-end type safety, easy to follow; each app ships as its own container/Deployment.
- **Negative / risks:** Monorepo tooling (pnpm workspaces, per-app Dockerfiles) needs a bit of upfront setup.
- **Revisit when:** A prototype needs server rendering or public SEO.
