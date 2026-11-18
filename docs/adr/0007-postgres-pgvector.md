# ADR-0007: One Postgres (with pgvector), in-cluster via CloudNativePG

- **Status:** Accepted — amended by [ADR-0011](0011-temporal-single-pod.md) (Temporal no longer uses Postgres)
- **Date:** 2026-11-17

## Context

The app, Temporal ([ADR-0002](0002-temporal-durable-runtime.md)) and LiteLLM ([ADR-0005](0005-llm-gateway-litellm.md)) all need a database, and RAG needs vector search. The GKE cluster is created and destroyed per demo session to save cost.

## Decision

Run **one Postgres cluster** with separate databases and users for `app`, `temporal`, `temporal_visibility` and `litellm`. Enable **pgvector** in the `app` database for embeddings.

- **Local (k3d) and GKE (default):** **CloudNativePG** operator, in-cluster
- **GKE (optional):** **Cloud SQL for PostgreSQL** behind a Terraform flag (`use_cloud_sql = true`), connected through the Cloud SQL Auth Proxy with Workload Identity
- Demo data is recreated by seed scripts; anything worth keeping is backed up to GCS before teardown

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Cloud SQL by default | Right managed answer, but billed even while the cluster is down and slow to create/destroy |
| AlloyDB | More performance than needed; higher minimum cost |
| Separate vector DB (Qdrant, Weaviate) | Another stateful service; pgvector is enough at prototype scale |
| One Postgres per component | More pods and resources for no demo benefit |

## Consequences

- **Positive:** Fewest stateful services; same setup locally and on GKE; pgvector keeps RAG in SQL.
- **Negative / risks:** In-cluster data disappears with the cluster unless backed up; one database is a shared failure point (fine for prototypes).
- **Revisit when:** A demo needs data that survives teardown — switch on Cloud SQL.
