# ADR-0004: Google Vertex AI as the model provider

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The platform runs on GKE. Models must be callable from pods without long-lived keys, and routing between several models should be real, not hypothetical.

## Decision

Use **Vertex AI** for all model calls: Gemini models plus partner models from **Model Garden** (e.g., Claude, Llama, Mistral) where enabled. Pods authenticate with **Workload Identity Federation for GKE** — no service-account key files. Calls go through the LiteLLM gateway ([ADR-0005](0005-llm-gateway-litellm.md)), which is the only component with Vertex permissions (`roles/aiplatform.user`).

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Direct provider APIs (Anthropic, OpenAI) | Separate keys and billing per provider; weaker GCP story |
| Self-hosted open models on GKE GPUs | GPU node cost is far higher than API calls for demo traffic. Possible later prototype using GKE Inference Gateway |

## Consequences

- **Positive:** One billing account, IAM-based auth, multiple model families for routing and fallback demos; native to the GCP platform the rest of the project runs on.
- **Negative / risks:** Partner model availability and quotas vary by region and must be enabled in Model Garden. **Local dev** uses your own Application Default Credentials (`gcloud auth application-default login`), mounted into the k3d gateway pod as a local-only secret — never committed and never used on GKE.
- **Revisit when:** A needed model isn't on Vertex, or a prototype is about self-hosted inference.
