# Portal: API and web UI

The agent portal from [ADR-0021](../../docs/adr/0021-agent-portal-ui.md), as one Deployment ([ADR-0013](../../docs/adr/0013-consolidated-workloads.md)): a Fastify API (`apps/api`) that also serves the React UI built by Vite (`apps/web`). On k3d it replaces the old placeholder at **http://localhost**; on GKE it sits behind the Gateway and IAP.

## What it reads and what it may do

| Source | How | Used for |
|---|---|---|
| Temporal | gRPC client to `temporal:7233` | Lists each agent's cases (newest run per case id; eval runs are excluded by id prefix), reads each case's state query (`caseState`, `progress`), sends the `review` update and the `recheck` signal, starts the exception queue |
| LiteLLM | `http://litellm:4000` with a **viewer** key (Secret `litellm-portal-key`) | Spend and budget per agent key, gateway health. The key's user has the `proxy_admin_viewer` role and a $0 budget: it can read, not spend or change keys. The master key is never given to the portal |
| Kubernetes API | The pod's service account, read-only Role `portal-reader` | MCP server ready replicas and HPA range, Postgres cluster health |

Writes, all through Temporal, so the workflow's own rules still apply: approve or send back a proposal (the workflow refuses a review it isn't waiting for, and a send-back without feedback), ask a waiting case to re-check, start the invoice exception queue (10 at a time from the UI). The reviewer recorded is the signed-in user from IAP's `x-goog-authenticated-user-email` header on GKE, `local-user` on k3d; a reviewer name in the request body is ignored.

## Endpoints

| Method and path | Returns |
|---|---|
| `GET /api/agents` | All six agents: live status, runs in 24 hours, cases that need a person, last eval pass rate, spend against budget; `coming_soon` for agents not built |
| `GET /api/agents/:id/cases` | The agent's recent cases, one row per case |
| `GET /api/cases/:workflowId` | One case: summary plus the workflow's full state (timeline, evidence, proposal, route, tool calls, skills, cost) |
| `POST /api/cases/:workflowId/review` | `{ approved, feedback? }` → the workflow's `review` update |
| `POST /api/cases/:workflowId/recheck` | `{ reason }` → the `recheck` signal (invoice cases) |
| `POST /api/agents/invoice-exception-resolver/queue` | `{ limit }` → starts `resolveExceptionQueue` |
| `GET /api/mission` | Mission Control: platform health, key figures, recent runs, boundary events, MCP servers |
| `GET /api/me`, `GET /healthz` | Signed-in user; health check for probes and the load balancer |

## Develop

```bash
pnpm build                                  # compiles the API (and everything else)
pnpm --filter @agents/web build             # builds the UI into apps/web/dist
kubectl -n agents port-forward svc/temporal 7233:7233 &
kubectl -n agents port-forward svc/litellm 4000:4000 &
TEMPORAL_ADDRESS=localhost:7233 LITELLM_BASE_URL=http://localhost:4000 \
  LITELLM_VIEWER_KEY="$(kubectl -n agents get secret litellm-portal-key -o jsonpath='{.data.PORTAL_LITELLM_KEY}' | base64 -d)" \
  WEB_DIR=apps/web/dist node apps/api/dist/main.js     # http://localhost:8080
pnpm --filter @agents/web dev               # UI with hot reload on :5173, /api proxied to :8080
```

Outside the cluster the Kubernetes panels show "unknown". Tests: [`test/app.test.ts`](test/app.test.ts) (fake Temporal, LiteLLM and Kubernetes sources).
