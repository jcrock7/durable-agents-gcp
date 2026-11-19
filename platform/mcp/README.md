# MCP servers

Tools that agents call run here as MCP servers in the cluster ([ADR-0020](../../docs/adr/0020-mcp-tools-and-skills.md)): one Deployment, Service and ServiceAccount each, Streamable HTTP on port 8080 at `/mcp`, reachable only from the agent worker. Agents reach them through the allow-listed client in [agent-kit](../../packages/agent-kit/).

| Server | Built from | Tools | Credentials | Used by |
|---|---|---|---|---|
| `mcp-erp-read` | MCP Toolbox for Databases 1.15.0, [`erp-read/tools.yaml`](erp-read/tools.yaml) | `get_invoice`, `get_purchase_order`, `get_receipts`, `get_vendor`, `get_item`, `get_contract_prices`, `get_invoice_history`, `search_vendor_messages`, `list_open_exceptions` | Postgres role `erp_reader`: SELECT only (Secret `pg-erp-reader`) | [Invoice Exception Resolver](../../agents/general/invoice-exception-resolver/) |
| `mcp-erp-write` | MCP Toolbox for Databases 1.15.0, [`erp-write/tools.yaml`](erp-write/tools.yaml) | `post_resolution`, `queue_message`, `set_invoice_hold` | Postgres role `erp_writer`: insert resolutions and outbox messages, update invoice and exception status only (Secret `pg-erp-writer`) | Same agent, **workflow only** |
| `mcp-docs` | Custom, [`apps/mcp-docs`](../../apps/mcp-docs/) | `list_directory`, `read_text_file`, `read_pdf_text`, `read_media_file` | None. The synthetic document store is built into the image | Same agent |

## How they are secured

- **Least privilege per server.** Each ERP server has its own Postgres login, and the grants are in the seed SQL ([`sql.ts`](../../agents/general/invoice-exception-resolver/src/data/sql.ts)). `erp_writer` cannot read vendors, prices or messages at all.
- **Network.** [`networkpolicies.yaml`](networkpolicies.yaml) lets only pods labelled `app.kubernetes.io/name: worker` reach `app.kubernetes.io/component: mcp-server` pods. Postgres accepts `mcp-erp-read` and `mcp-erp-write` ([base policies](../k8s/base/networkpolicies.yaml)).
- **Host check.** Each server accepts only its own Service names and `localhost` (for `kubectl port-forward`) in the `Host` header, against DNS rebinding.
- **Containers.** Non-root, read-only root filesystem, no capabilities, no service account token.
- **Write tools never reach the model.** The agent's allow-list marks every `erp-write` tool workflow-only; the agent-kit client refuses them to the model and leaves them out of what it sees.

## Why `docs` is custom

The design called for the reference MCP filesystem server. That server speaks MCP over stdio only, so running it in the cluster would need a stdio-to-HTTP proxy in front of it. The custom server is about 150 lines on the official MCP SDK, serves Streamable HTTP directly, mirrors the reference server's tool names, and adds `read_pdf_text` so invoice text can pass through the gateway's prompt-injection check before a model reads it. It reads only PDFs written by the synthetic-data generator (uncompressed text); real documents would need a proper PDF parser.

## Deploying and checking

The apply scripts (`scripts/local/apply-k8s.sh`, `scripts/gke/apply-k8s.sh`) build the `mcp-docs` image, create the two Postgres Secrets, deploy these servers with the rest of the platform, and load the synthetic ERP once.

```bash
scripts/local/mcp-verify.sh    # tools per server, one call per server, allow-list checks; changes no data
scripts/local/erp-load.sh      # reset the ERP to its seeded state
```

## Adding a server

Add a folder with a Deployment, Service and ServiceAccount, labelled `app.kubernetes.io/name: mcp-<server>` and `app.kubernetes.io/component: mcp-server`, listen on 8080 at `/mcp`, list it in [`kustomization.yaml`](kustomization.yaml), and add its tools to the agent's allow-list. A custom server goes in `apps/mcp-<server>/` so `build-push.sh` can build it.
