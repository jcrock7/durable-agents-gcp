# ADR-0011: Run Temporal as a single dev-server pod on GKE for the prototype

- **Status:** Accepted — supersedes the GKE deployment part of [ADR-0002](0002-temporal-durable-runtime.md); amends [ADR-0007](0007-postgres-pgvector.md)
- **Date:** 2026-11-17

## Context

[ADR-0002](0002-temporal-durable-runtime.md) chose Temporal (still valid) and planned the official Helm chart on GKE. That chart runs about five services (frontend, history, matching, worker, UI) and needs two Postgres databases — roughly 1 vCPU / 2 GB and the slowest part of `up.sh`. Demo traffic is a handful of workflows at a time.

## Decision

On GKE, run **one Temporal pod** using the Temporal CLI dev server:

- `temporal server start-dev --ip 0.0.0.0 --db-filename /data/temporal.db`
- SQLite file on a small persistent volume, so workflow history survives pod restarts
- Web UI on port 8233, `ClusterIP` only (port-forward or an IAP-protected route for demos)
- Runs on **on-demand** capacity, not Spot ([ADR-0014](0014-gke-autopilot-spot.md))
- The `temporal` and `temporal_visibility` databases are removed from the shared Postgres ([ADR-0007](0007-postgres-pgvector.md))

Local k3d uses the same setup, so local and GKE behave the same.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Official Helm chart (ADR-0002 plan) | ~4 extra pods and two databases for demo-scale load |
| Temporal Cloud | Least ops, but ongoing cost; still the best production path |
| Drop Temporal | Loses the core "durable agents" story |

## Consequences

- **Positive:** Saves ~1 vCPU / 2 GB and four pods; faster spin-up; same Temporal APIs, so agent code is unchanged.
- **Negative / risks:** Single point of failure with no horizontal scaling; SQLite isn't a production persistence store. The "kill a **worker** pod and the run resumes" demo still works. Killing the **server** pod works too, but the server is offline while it restarts.
- **Production path:** For the prototype we run Temporal's single-binary server. In production, use Temporal Cloud or the Helm chart on Postgres or Cassandra — the workflow code doesn't change.
- **Revisit when:** A demo needs concurrency or high availability, or for a production-like walkthrough.
