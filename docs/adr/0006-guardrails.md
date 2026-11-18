# ADR-0006: Guardrails — Presidio + LLM Guard via LiteLLM hooks

- **Status:** Superseded by [ADR-0012](0012-guardrails-lightweight.md)
- **Date:** 2026-11-17

## Context

Agents must block or redact PII, detect prompt injection (especially from tool and RAG content), and filter unsafe output. Checks should apply to every agent without per-agent code, and must be open source.

## Decision

Apply guardrails at the **gateway** using LiteLLM's guardrail hooks ([ADR-0005](0005-llm-gateway-litellm.md)):
- **Microsoft Presidio** — PII detection and masking on input and output
- **LLM Guard** — prompt-injection, jailbreak and toxicity scanners

Both run as separate Python services in the cluster. App-level checks remain for business rules (e.g., tool allow-lists, human approval via Temporal signals for risky actions).

**Managed alternative:** Google **Model Armor** (not open source) screens prompts and responses and integrates with Vertex AI — the likely choice for production on GCP.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| NeMo Guardrails | Powerful dialogue rails (Colang), but heavier and its conversation model overlaps with the agent/workflow layer |
| Guardrails AI | Strong for output validation; schema checks are already covered by Zod structured output ([ADR-0003](0003-agent-framework.md)) |
| Guard model (Llama Guard / ShieldGemma) | Good classifier quality but needs GPU hosting or an extra model call per request; can be added as a LiteLLM guardrail later |
| Model Armor only | Managed and not open source; kept as the documented production alternative |

## Consequences

- **Positive:** Every agent gets the same protections; easy to demo (send a prompt injection, watch it get blocked and logged).
- **Negative / risks:** Two more services and extra latency per call; scanners produce false positives that need tuning.
- **Revisit when:** Moving toward production — evaluate Model Armor versus self-hosted scanners.
