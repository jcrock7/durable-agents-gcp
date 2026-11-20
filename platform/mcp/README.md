# MCP servers

Tools that agents call run here as MCP servers in the cluster ([ADR-0020](../../docs/adr/0020-mcp-tools-and-skills.md)): one Deployment, Service and ServiceAccount each, Streamable HTTP on port 8080 at `/mcp`, reachable only from the agent worker. Agents reach them through the allow-listed client in [agent-kit](../../packages/agent-kit/).

| Server | Built from | Tools | Credentials | Used by |
|---|---|---|---|---|
| `mcp-erp-read` | MCP Toolbox for Databases 1.15.0, [`erp-read/tools.yaml`](erp-read/tools.yaml) | `get_invoice`, `get_purchase_order`, `list_vendor_purchase_orders`, `get_receipts`, `get_vendor`, `get_item`, `get_contract_prices`, `get_invoice_history`, `search_vendor_messages`, `list_open_exceptions` | Postgres role `erp_reader`: SELECT only (Secret `pg-erp-reader`) | [Invoice Exception Resolver](../../agents/general/invoice-exception-resolver/), `mcp-match-engine` |
| `mcp-erp-write` | MCP Toolbox for Databases 1.15.0, [`erp-write/tools.yaml`](erp-write/tools.yaml) | `post_resolution`, `queue_message`, `set_invoice_hold` | Postgres role `erp_writer`: insert resolutions and outbox messages, update invoice and exception status only (Secret `pg-erp-writer`) | Same agent, **workflow only** |
| `mcp-docs` | Custom, [`apps/mcp-docs`](../../apps/mcp-docs/) | `list_directory`, `read_text_file`, `read_pdf_text`, `read_media_file` | None. The synthetic document store is built into the image | Same agent |
| `mcp-match-engine` | Custom, [`apps/mcp-match-engine`](../../apps/mcp-match-engine/). **HorizontalPodAutoscaler, 1–10 replicas on CPU** | `run_match`, `check_duplicate`, `compute_adjustment` | None. Reads ERP data through `mcp-erp-read` | Same agent (workflow and activities) |

## match-engine: the deterministic part, and the part that scales

`match-engine` does the arithmetic so no model ever does: a three-way match of invoice, PO and receipts in integer cents with explicit tolerance rules (the lower of 2% and $50.00 by default; the agent passes its own policy per call), a duplicate check, and the amount for each resolution action (variance to accept, credit to request, amount to withhold). Findings carry the evidence a model needs to judge cause, such as whether the contract price on the invoice date supports a variance. The same input always gives the same output.

Tests: every one of the 96 seeded exceptions is classified into its labelled type with its labelled amount, and all 892 clean invoices match ([`engine.test.ts`](../../apps/mcp-match-engine/test/engine.test.ts)). Against the deployed server, through the real `erp-read` loader, all 96 labels agree as well.

It is stateless and CPU-bound, so it scales with a standard HPA: CPU request 100m, target 60% average, scale up by up to 4 pods every 15 seconds, scale down by 2 every 30 seconds after 2 minutes below target. `scripts/local/match-engine-load.sh` runs an in-cluster load test (a Job on the same image) and prints the HPA as it moves. One run on k3d, 24 concurrent sessions for 3 minutes:

| Time | CPU (share of request) | Replicas |
|---|---|---|
| 0:00 | 105% | 1 → 2 |
| 0:30 | 1,289% | 2 → 6 |
| 0:45 | 1,226% | 6 → 10 |
| 1:00 to 3:20 | 263–285% | 10 (the maximum) |
| after the load | 1% | 10 → 8 → … (down 2 pods every 30 seconds) |

24,321 `run_match` calls, 0 errors; throughput rose from about 108 to 144 calls a second as replicas came up, with p95 latency falling from 424 ms to about 220 ms. At 10 replicas CPU stayed above target, so the ceiling of 10 (and the namespace quota behind it) is what limited it, by design.

## How they are secured

- **Least privilege per server.** Each ERP server has its own Postgres login, and the grants are in the seed SQL ([`sql.ts`](../../agents/general/invoice-exception-resolver/src/data/sql.ts)). `erp_writer` cannot read vendors, prices or messages at all.
- **Network.** [`networkpolicies.yaml`](networkpolicies.yaml) lets only pods labelled `app.kubernetes.io/name: worker` reach `app.kubernetes.io/component: mcp-server` pods, plus two narrow paths: `mcp-match-engine` → `mcp-erp-read`, and the on-demand load test → `mcp-match-engine`. Postgres accepts `mcp-erp-read` and `mcp-erp-write` ([base policies](../k8s/base/networkpolicies.yaml)). A new Toolbox pod can restart once at start-up while the cluster programs its network policy; it then connects.
- **Host check.** Each server accepts only its own Service names and `localhost` (for `kubectl port-forward`) in the `Host` header, against DNS rebinding.
- **Containers.** Non-root, read-only root filesystem, no capabilities, no service account token.
- **Write tools never reach the model.** The agent's allow-list marks every `erp-write` tool workflow-only; the agent-kit client refuses them to the model and leaves them out of what it sees.

## Why `docs` is custom

The design called for the reference MCP filesystem server. That server speaks MCP over stdio only, so running it in the cluster would need a stdio-to-HTTP proxy in front of it. The custom server is about 150 lines on the official MCP SDK, serves Streamable HTTP directly, mirrors the reference server's tool names, and adds `read_pdf_text` so invoice text can pass through the gateway's prompt-injection check before a model reads it. It reads only PDFs written by the synthetic-data generator (uncompressed text); real documents would need a proper PDF parser.

## Deploying and checking

The apply scripts (`scripts/local/apply-k8s.sh`, `scripts/gke/apply-k8s.sh`) build the `mcp-docs` and `mcp-match-engine` images, create the two Postgres Secrets, deploy these servers with the rest of the platform, and load the synthetic ERP once.

```bash
scripts/local/mcp-verify.sh           # tools per server, one call per server, allow-list checks; changes no data
scripts/local/match-engine-load.sh    # HPA demo: 3 minutes of load, prints replicas as they change
scripts/local/erp-load.sh             # reset the ERP to its seeded state
```

## Adding a server

Add a folder with a Deployment, Service and ServiceAccount, labelled `app.kubernetes.io/name: mcp-<server>` and `app.kubernetes.io/component: mcp-server`, listen on 8080 at `/mcp`, list it in [`kustomization.yaml`](kustomization.yaml), and add its tools to the agent's allow-list. A custom server goes in `apps/mcp-<server>/` so `build-push.sh` can build it.
