# ADR-0013: Consolidate app workloads — API serves the UI, one shared agent worker

- **Status:** Accepted — amends [ADR-0001](0001-typescript-monorepo.md) (deployment) and [ADR-0008](0008-observability.md) (telemetry export)
- **Date:** 2026-11-17

## Context

The original layout had a separate web pod, one worker Deployment per agent, and (implicitly) an OpenTelemetry collector. At demo scale each extra pod adds cost (Autopilot bills per pod, with minimum sizes), spin-up time, and things to debug.

## Decision

- **UI:** the Vite build output is served as static files by the **Fastify API** (`@fastify/static`). One image, one Deployment. The code stays separate (`apps/web`, `apps/api`).
- **Agents:** **one worker Deployment** (`apps/worker`) registers every agent's workflows and activities, each on **its own task queue**. Agent code stays in `agents/<name>/` as workspace packages.
- **Telemetry:** services export **directly** to Cloud Trace/Logging/Monitoring with Google Cloud exporters — no collector pod.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Separate web pod (nginx) | Extra pod for a few static files |
| One worker Deployment per agent | One pod per agent; no isolation needed at demo scale |
| OpenTelemetry collector | Useful for fan-out and sampling; unnecessary with one backend |

## Consequences

- **Positive:** App tier is two pods (api, worker); simpler manifests and faster deploys.
- **Negative / risks:** A crash in one agent's code restarts the worker for all agents; UI and API scale together.
- **Scaling note:** Separate task queues let any agent be moved to its own Deployment with a manifest change only — a straightforward path to scaling.
- **Revisit when:** One agent needs separate scaling, resources or isolation.
