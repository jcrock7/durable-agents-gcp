# ADR-0008: Observability — OpenTelemetry to Cloud Trace/Logging; Langfuse deferred

- **Status:** Accepted — amended by [ADR-0013](0013-consolidated-workloads.md) (direct export, no collector)
- **Date:** 2026-11-17

## Context

Demos and debugging need traces that follow one agent run across the UI, API, Temporal workflow, gateway and model call, plus per-run token and cost data. The observability stack must not outweigh the app on a cluster that's torn down after each session.

## Decision

- Instrument UI, API and workers with **OpenTelemetry**, propagating trace context into Temporal (the SDK's OpenTelemetry interceptors).
- **GKE:** export to **Cloud Trace**, **Cloud Logging** and **Cloud Monitoring** (Google-managed, nothing to host).
- **Local:** export to a local Jaeger container (optional).
- Cost and token data per run come from LiteLLM spend logs ([ADR-0005](0005-llm-gateway-litellm.md)).
- **Deferred:** **Langfuse** for LLM-specific tracing, prompt management and scoring — added once the core stack is stable.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Langfuse now | Excellent LLM tracing, but v3 needs ClickHouse, Redis and object storage — heavy for an ephemeral cluster |
| Arize Phoenix | Good open-source LLM tracing; similar tradeoff, Python-centric |
| Prometheus + Grafana + Tempo in-cluster | More to run; Google Cloud Observability is already included with GKE |

## Consequences

- **Positive:** Vendor-neutral instrumentation; managed backends with no extra pods; one trace per agent run is a strong demo.
- **Negative / risks:** Cloud Trace has fewer LLM-specific views (prompts, scores) until Langfuse is added.
- **Revisit when:** Evals and prompt iteration need richer LLM traces — add Langfuse via OpenTelemetry.
