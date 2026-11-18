# ADR-0012: Lightweight guardrails for the prototype

- **Status:** Accepted — supersedes [ADR-0006](0006-guardrails.md)
- **Date:** 2026-11-17

## Context

[ADR-0006](0006-guardrails.md) planned Presidio and LLM Guard as in-cluster services. LLM Guard loads transformer models (~2–4 GB of memory, slow on CPU), and Presidio's large spaCy model needs ~1.5 GB. Together they'd be about 40% of the pod bill, for checks that can be demonstrated more cheaply.

## Decision

Guardrails in layers, with no extra model-serving pods:

1. **Model-side:** Vertex AI's built-in **safety filters** (harm categories) on every Gemini call, configured in LiteLLM ([ADR-0005](0005-llm-gateway-litellm.md)).
2. **Gateway-side:** a **LiteLLM custom guardrail** that classifies input (user input and retrieved/tool content) for prompt injection using a cheap model (Gemini Flash-Lite) with a strict JSON verdict. Blocked requests are logged with a reason.
3. **App-side:** tool allow-lists per agent, Zod validation of tool arguments, and **human approval** (Temporal signal) before risky actions.
4. **Deferred:** **Presidio** with the *small* spaCy model, added only for a prototype that handles PII.
5. **Production path (documented):** **Google Model Armor** for managed prompt/response screening.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Presidio + LLM Guard (ADR-0006) | ~3–5 GB of memory and slow CPU inference |
| Guard model on GPU (Llama Guard / ShieldGemma) | GPU node cost |
| Model Armor now | Managed and not open source; kept as the production answer |

## Consequences

- **Positive:** No guardrail pods; guardrails stay demoable (send an injection, watch it get blocked and logged); clean "defense in depth" story.
- **Negative / risks:** An LLM-based classifier adds a small cost and latency per call and can be fooled — mitigated by the app-side layer (allow-lists, approvals) and red-team evals ([ADR-0009](0009-evals-promptfoo.md)).
- **Revisit when:** A prototype processes PII (add Presidio), or for a production-readiness walkthrough (Model Armor).
