# ADR-0014: GKE Autopilot, with Spot for stateless pods and on-demand for stateful pods

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The cluster is created before each demo and destroyed after it. We want the lowest cost per hour, the least node management, and a setup that still uses core GKE concepts (Workload Identity, Spot capacity, Gateway API).

## Decision

- **GKE Autopilot**, regional (Autopilot clusters are regional), with Workload Identity, Gateway API and the Secret Manager add-on enabled.
- **Spot pods** for stateless workloads — api, worker, LiteLLM — using `nodeSelector: cloud.google.com/gke-spot: "true"` and a termination grace period under the Spot limit.
- **On-demand pods** for stateful workloads — Postgres (CloudNativePG) and Temporal ([ADR-0011](0011-temporal-single-pod.md)).
- Right-sized resource requests on every pod (Autopilot bills requests, not usage).
- The GKE free tier credit covers the cluster management fee for one Autopilot cluster per billing account.

## Which pods can run on Spot (added 2026-11-18)

A Spot pod costs roughly 60–90% less than an on-demand pod. In exchange, Google can reclaim its node at any time with at most **25 seconds** of shutdown time, and Spot capacity can be unavailable, leaving the pod Pending. A workload belongs on Spot only if it can be killed mid-request and restarted elsewhere without anyone noticing more than a short pause.

Each workload is scored on four questions:

1. **State:** does the pod hold data, or is a disk attached to it? An attached disk lives in one zone, so the pod can only reschedule in that zone, where Spot capacity may be short, and only after the disk is detached and reattached.
2. **Retry:** if the pod dies mid-request, does a caller retry automatically? With an automatic retry, a preemption costs seconds. Without one, a user sees an error.
3. **Replicas:** is it a single replica? Then a preemption is an outage of that service, not just lost capacity.
4. **Blast radius:** while it's down, does one feature degrade, or does the whole system stall?

| Workload | State | Who retries | Replicas | Blast radius while down | Capacity |
|---|---|---|---|---|---|
| Temporal workers | None; workflow state lives in Temporal | Temporal reassigns the task after its timeout | 1+ | Workflows pause, then resume at the step they stopped on | **Spot**, the ideal fit |
| LiteLLM | None; keys and spend logs live in Postgres | The Temporal activity that made the LLM call | 1 | LLM calls pause for about 30–60s | **Spot** |
| API / UI | None | The browser, or the user refreshing | 1+ | A brief error page | **Spot** |
| Postgres (CloudNativePG) | 5 Gi disk | Nothing; clients fail to connect | 1, no standby | The app, LiteLLM and agent memory all fail | **On-demand** |
| Temporal server | 1 Gi disk (SQLite) | Workers reconnect, but nothing progresses meanwhile | 1 (the dev server can't be clustered) | Every workflow stops | **On-demand** |

The rule: **stateless and retried by a caller → Spot. Holds state, runs as a single replica, or is the thing everything else retries against → on-demand.**

Why the two stateful services stay on on-demand:

- **Preemption risks availability, not data.** The disks survive preemption, and both Postgres and SQLite recover cleanly after a crash. The cost is time: reattaching the disk in the same zone, Postgres replaying its WAL, and every dependent service erroring meanwhile. That can take minutes, or longer when Spot capacity in that zone is short.
- **Temporal is what makes the rest safe to put on Spot.** Killing a worker or LiteLLM is harmless only because Temporal keeps the workflow's progress and retries. If Temporal itself is on Spot, there is nothing left to recover the other services' work.
- **The saving would be small.** Postgres and Temporal request little CPU and memory, so moving them to Spot saves cents per hour, not enough to justify a demo failing in front of an audience.

## Estimated cost (us-central1 list prices; verify with the pricing calculator)

| Item | Approx. $/hr |
|---|---|
| Pods (~2 vCPU / 5 GB requested, mostly Spot) | ~$0.04–0.06 |
| External load balancer forwarding rule | ~$0.025 |
| Cloud NAT, in-use static IP, small disks | ~$0.01–0.02 |
| Cluster management fee | ~$0 (free tier credit) |
| **Infrastructure total** | **~$0.08–0.15** |
| Vertex AI tokens (Flash/Flash-Lite defaults) | ~$0.05–0.50, more with larger models |

### Free Tier and free trial notes (added 2026-11-17)

From the [Google Cloud Free Tier](https://cloud.google.com/free) page:

- The GKE Free Tier covers the **cluster management fee** for one Autopilot or zonal cluster per month (per billing account). Pods, load balancers and disks are still billed.
- **Not covered by Free Tier:** load balancing, Cloud NAT and Vertex AI. Cloud Scheduler and Cloud Trace have small allowances on their own pricing pages.
- The **$300 free trial credit can't pay for Vertex AI (Gemini) or partner models** for accounts that start a trial on or after 2026-11-16. Model tokens are real spend from day one, and Vertex AI may require upgrading to a paid account.
- Free Tier limits are per billing account (logging is per project) and don't roll over. Free Cloud Storage only applies in us-central1, us-east1 and us-west1. This project uses us-central1.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| GKE Standard, zonal, Spot node pool | Similar cost, but requires node sizing and leaves idle node capacity — a candidate for a later "Standard" variant |
| Everything on Spot | Postgres or Temporal preemption mid-demo stalls every other service (see the table above) |
| Postgres on Spot with 2–3 replicas across zones | The production pattern: CloudNativePG fails over to a standby when one instance is preempted. It doubles or triples the Postgres cost to save cents, so it isn't worth it for a prototype |
| Everything on-demand | ~2–3× the pod cost |
| Cloud Run instead of GKE | Cheaper when idle, but the project's purpose is GKE |

## Consequences

- **Positive:** No nodes to manage; pay only for requested pod resources; Spot preemption becomes a live durability demo (Temporal resumes the agent).
- **Negative / risks:** Autopilot restricts some workloads (privileged pods, some DaemonSets) and enforces minimum pod sizes; Spot pods can be evicted at any time. An LLM response that streams for longer than LiteLLM's 25-second shutdown window is cut off at preemption. Temporal retries the activity, so no work is lost, but the tokens are paid for twice. Activities that call models must therefore be safe to retry.
- **Revisit when:** A prototype needs node-pool control, or costs drift above estimate (compare actual billing per session).
