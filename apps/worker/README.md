# Worker

One process runs every agent: a Temporal Worker per agent, each polling the agent's own task queue ([ADR-0013](../../docs/adr/0013-consolidated-workloads.md)). Agents are listed in [src/agents.ts](src/agents.ts).

| File | What |
|---|---|
| [src/main.ts](src/main.ts) | Connects to Temporal (retrying for up to ~2 minutes), starts the workers, serves `/healthz` on 8080, and shuts down gracefully on SIGTERM (20s for running activities) |
| [src/bundle.ts](src/bundle.ts) | Build step: bundles each agent's workflow code into `dist/bundles/<agent>.js`, so the worker starts in seconds |
| [Dockerfile](Dockerfile) | Two stages: pnpm install, TypeScript build and bundling, then only production files on `node:24` slim as user 1000 |
| [k8s/](k8s/) | The Deployment: non-root, read-only filesystem, agent keys from Secret `litellm-agent-keys`. The overlays set the image and, on GKE, Spot |

The worker holds no state: workflow progress lives in Temporal, so the pod can be killed at any time, and runs on Spot on GKE.

| Setting | Default |
|---|---|
| `TEMPORAL_ADDRESS` | `temporal:7233` |
| `TEMPORAL_NAMESPACE` | `default` |
| `LITELLM_BASE_URL` | `http://litellm:4000/v1` |
| `LITELLM_KEY_<AGENT>` | from Secret `litellm-agent-keys`, created by the apply scripts |
| `WORKFLOW_BUNDLE_DIR` | `/app/dist/bundles` in the image; unset locally (bundles at start) |

Build and deploy: `scripts/local/apply-k8s.sh` or `scripts/gke/apply-k8s.sh` (both run `build-push.sh worker` first).
