# Invoice Exception Resolver

> **Status: building.** M1 (MCP client, allow-list, tool loop, skill loader in [agent-kit](../../../packages/agent-kit/)) and M2 (synthetic ERP, document store, and the `erp-read`, `erp-write` and `docs` MCP servers in [platform/mcp](../../../platform/mcp/)) are done; M3 onward are next. This README is the design. It becomes the agent's normal README as each milestone lands. Why this agent: [business case](business-case.md). Where it fits: [ADR-0019](../../../docs/adr/0019-pattern-agent-portfolio.md). How tools and skills work: [ADR-0020](../../../docs/adr/0020-mcp-tools-and-skills.md).

Works the invoices a three-way match rejects. It reruns the match deterministically, classifies the exception, gathers evidence from the ERP, documents and the vendor mailbox, and proposes a cited resolution. It chases the vendor or the receiving dock and waits for days if needed. A person approves anything that changes what gets paid. This is the **template agent** for [ADR-0019](../../../docs/adr/0019-pattern-agent-portfolio.md): the first agent built on MCP tools and skills, and the one the next four copy.

## How it works

```text
exception queue ──► resolveExceptionQueue (parent workflow, fan-out, max N in parallel)
                          │ one child per exception
                          ▼
              resolveInvoiceException
                          │
   1 match ──► 2 read invoice ──► 3 gather evidence ──► 4 propose ──► 5 route
 (match-engine)   (fast, PDF)    (fast + read tools,    (smart,       (rules in workflow)
                                  up to 4 rounds)        cited)            │
          ┌──────────────────────────────────────┬────────────────────────┼─────────────────────┐
          ▼                                      ▼                        ▼                     ▼
   money changes or fraud flag            vendor / internal message   wait for receipt     duplicate or
   ──► review (person approves,           ──► send (approval above    ──► daily re-match   wrong PO
       edits or rejects)                      threshold) ──► wait for                       ──► review
          │                                   reply (reminders at
          │                                   day 3 and 7, escalate
          │                                   at day 10)
          │                                      │ reply arrives / receipt posted
          │                                      └──► back to 1 (max 3 rounds)
          ▼
   6 post resolution (erp-write) ──► 7 re-match to confirm ──► result
```

| Step | Runs as | Model / tool |
|---|---|---|
| 1. Match | activity `runMatch` | `match-engine:run_match`, `match-engine:check_duplicate` |
| 2. Read invoice | activity `readInvoice` | `docs:read_pdf_text` → `fast` (text in, structured fields out; text passes the gateway's injection check). `docs:read_media_file` stays available for a model that reads the PDF directly |
| 3. Gather evidence | activity `gatherEvidence`: a model-driven loop over read-only tools, max 4 rounds | `fast` + `erp-read:*`, `docs:read_text_file` |
| 4. Propose | activity `proposeResolution` | `smart`, structured output. Citations and action validated. Amounts recomputed by `match-engine:compute_adjustment` |
| 5. Route | workflow code | Rules from `agent.config.ts`: action, amount and flags |
| Review | Temporal update `review` (`ReviewGate`) | A person: approve, edit the action, or reject with a note |
| Send message | activity `queueMessage` | `fast` drafts from a template → `erp-write:queue_message` |
| Wait | workflow timers and signals | Signal `vendorReplied`; daily timer re-runs `run_match` while waiting for a receipt |
| 6. Post | activity `postResolution`, only after approval where required | `erp-write:post_resolution` |
| 7. Confirm | activity `runMatch` | `match-engine:run_match`; the invoice must now match or be on hold |

## Tools

All tools are MCP servers in the cluster, one Deployment each, under `platform/mcp/` ([ADR-0020](../../../docs/adr/0020-mcp-tools-and-skills.md)).

| Server | Built from | Tools this agent may use | Who calls them | Credentials | Scales |
|---|---|---|---|---|---|
| `erp-read` ✅ | **Existing:** MCP Toolbox for Databases 1.15.0 (Postgres source, tools defined as parameterized SQL in [`tools.yaml`](../../../platform/mcp/erp-read/tools.yaml)) | `get_invoice`, `get_purchase_order`, `get_receipts`, `get_vendor`, `get_item`, `get_contract_prices`, `get_invoice_history`, `search_vendor_messages`, `list_open_exceptions` | Model (inside `gatherEvidence`) and workflow | Postgres role `erp_reader`: `SELECT` only | 1 replica |
| `erp-write` ✅ | **Existing:** MCP Toolbox for Databases, second instance ([`tools.yaml`](../../../platform/mcp/erp-write/tools.yaml)) | `post_resolution`, `queue_message`, `set_invoice_hold` | **Workflow only**, never offered to the model | Postgres role `erp_writer`: `INSERT` on `resolutions` and `outbox`, `UPDATE` of invoice and exception `status` only | 1 replica |
| `docs` ✅ | **Custom** ([`apps/mcp-docs`](../../../apps/mcp-docs/)): the reference filesystem server is stdio-only, so this small Streamable HTTP server replaces it ([why](../../../platform/mcp/README.md#why-docs-is-custom)). The document store is built into its image | `list_directory`, `read_text_file`, `read_pdf_text`, `read_media_file` | Activities | None; no volume | 1 replica |
| `match-engine` | **Custom:** TypeScript, official MCP SDK, stateless | `run_match`, `check_duplicate`, `compute_adjustment` | Activities and workflow | None: pure computation over inputs plus `erp-read` data | **HorizontalPodAutoscaler** on CPU, 1–10 replicas. The queue fan-out shows it scaling |

`match-engine` is deliberately boring: integer cents, explicit tolerance rules, and the same output for the same input, with unit tests on every exception type. It's the "deterministic tool next to model judgment" part of the demo, and the custom server that shows a standard HPA.

## Skills

Shared skills in `packages/skills/`, agent skills in `skills/`, each with a `SKILL.md` and a version ([ADR-0020](../../../docs/adr/0020-mcp-tools-and-skills.md)).

| Skill | Used by step | What it encodes |
|---|---|---|
| `three-way-match-exceptions` (agent) | Gather evidence, Propose | The exception types, which evidence settles each one, and what a well-supported proposal cites |
| `ap-resolution-policy` (agent) | Propose | The allowed actions and when each applies, what always needs a person, and the fraud red flags (bank or remittance changes, new payee, urgency pressure) |
| `vendor-correspondence` (shared) | Send message | Message structure, required facts (invoice, PO, line, amount), tone, what never goes in a message |
| `untrusted-content` (shared) | Every step that reads documents or email | How to treat document and email text as data, and what to report when it contains instructions |

Policy values (tolerances, thresholds, reminder days) live in `agent.config.ts`, not in the skills.

## Configuration (planned `agent.config.ts`)

| Setting | Prototype value | Meaning |
|---|---|---|
| `models` | `extract: fast`, `evidence: fast`, `propose: smart`, `draft: fast` | LiteLLM aliases per step |
| `tools` | The `server:tool` pairs in the table above | Allow-list. The MCP client drops anything else |
| `tolerance.pricePct` / `tolerance.priceCents` | 2% / 5,000 (the lower applies) | Price variance auto-accepted by the match itself. Example values, set per company |
| `tolerance.quantity` | 0 | Quantity must match exactly |
| `approval.amountCents` | 100,000 | Messages and actions above $1,000 need approval |
| `approval.alwaysFor` | `accept_variance`, `short_pay`, `reject_duplicate`, any fraud flag | Always need a person |
| `wait.reminderDays` / `wait.escalateDays` | 3 and 7 / 10 | Vendor follow-up schedule |
| `limits.evidenceRounds` / `limits.rounds` | 4 / 3 | Tool rounds per evidence step / match-propose-wait rounds per case |
| `queue.maxParallel` | 10 | Child workflows running at once in the fan-out |
| Budget | $3 per 30 days (`AGENT_BUDGETS_USD`) | About 100 exceptions |

## Synthetic data

A seeded generator ([`src/data/`](src/data/)) creates a small ERP in its own Postgres database `erp`, plus a document store of rendered invoice PDFs and vendor emails. Same seed, same data: `node dist/data/cli.js [out-dir] [seed]` writes `seed.sql`, `docs/` and `labels.json` (default `data/out/`, gitignored). The fixed "today" is 2026-11-17.

- **Tables:** `vendors`, `items`, `contract_prices`, `purchase_orders` + `po_lines`, `receipts` + `receipt_lines`, `invoices` + `invoice_lines`, `messages` (vendor mailbox), `exceptions` (the ERP's own match rejections, with reason codes), `resolutions`, `outbox`. Schema and grants: [`sql.ts`](src/data/sql.ts).
- **Scale:** 20 vendors, 200 items, 1,000 POs, 988 invoices (POs still in transit have none yet), 98 messages, 96 open exceptions (about 10%).
- **Seeded cases** ([`generate.ts`](src/data/generate.ts)), each with a label for evals: the expected type, action, whether a person must decide, a fraud flag, the expected amount and the evidence a good answer cites. Labels go to `labels.json` only, never into the ERP.

  | Scenario | Count | Expected action |
  |---|---|---|
  | Price variance from a contract price change, with the vendor's notice (includes the demo case INV-20931: 1,200 units, $2.92 → $3.99, $1,284.00) | 14 | `accept_variance` (person approves) |
  | Billed above contract and PO, no change on record | 12 | `request_credit_memo` |
  | Fewer units received than billed | 12 | `short_pay` |
  | No receipt, goods in transit (shipment notice) | 8 | `wait_for_receipt` |
  | No receipt, but delivered and signed for (proof of delivery) | 6 | `request_receipt_entry` |
  | Billed by the case against a PO in each; totals agree | 8 | `accept_uom_conversion` |
  | Freight billed, allowed by the vendor's terms | 6 | `accept_charge` |
  | Freight billed to a freight-prepaid vendor | 6 | `request_credit_memo` |
  | Paid invoice re-sent with a new number | 8 | `reject_duplicate` |
  | Invoice against the wrong (closed) PO | 8 | `reassign_po` |
  | Price variance with no contract price and no correspondence | 4 | `escalate` |
  | Remittance bank changed, urgent email from a look-alike domain | 2 | `escalate` with fraud flag |
  | Invoice PDF with hidden text telling the agent to approve it | 2 | blocked by the guardrail |

- **Documents:** one PDF per invoice (`invoices/INV-*.pdf`, written by a minimal dependency-free [PDF writer](src/data/pdf.ts)) and one text file per message (`emails/MSG-*.txt`). They are generated into the `mcp-docs` image together with the matching `seed.sql`, which the apply scripts load from there, so rows and documents always agree.
- **Vendor simulator (M4):** `data/simulate-reply.ts` writes a vendor reply into `messages` and signals the waiting run. It's the stand-in for a mail webhook.

Everything is synthetic. Vendor names are generated, not real companies.

## Result

`status`: `resolved` (posted and confirmed by re-match), `on_hold` (approved hold, for example awaiting a credit memo), `escalated` (sent to a person: low confidence, fraud flag, missing evidence or out of rounds), `rejected_by_reviewer`, `blocked` (guardrail), `expired` (no reviewer within 7 days).

It also carries: exception type, action taken, amounts (from `match-engine`), cited evidence IDs, approver, rounds, human touches, tokens and estimated cost, and skill and prompt versions.

## Demo (target, about 3 minutes)

1. **Queue:** start `resolveExceptionQueue` over 50 seeded exceptions. Temporal shows children fanning out; `kubectl get hpa match-engine` shows replicas climbing.
2. **Happy path:** a price variance from a contract price change. The agent cites the contract row and proposes a credit memo request. The message goes out under the threshold.
3. **Waiting:** a missing receipt. The run waits; posting the receipt in the ERP resolves it on the next daily check (time-skipped in the test environment, or triggered by a signal in the live demo).
4. **The boundary:** the bank-detail-change email is flagged as possible fraud and routed to a person. The hidden-text PDF is blocked by the guardrail. An over-threshold variance waits for approval.
5. **Approval:** approve one case with the `review` update, and watch it post and confirm.
6. **Crash:** kill the worker mid-case. The run resumes with earlier tool calls not repeated.
7. **Inspect:** the Temporal history shows each tool call with arguments and results. Gateway spend shows the cost per case.

## Build plan

| Milestone | Delivers | Done when |
|---|---|---|
| M1. Tools foundation ✅ | MCP client in `packages/agent-kit` (allow-list filter, call logging, step-limited tool loop); skill loader | Unit tests: unlisted tools dropped and refused; skill versions recorded |
| M2. Synthetic ERP ✅ | `erp` database, roles, generator, document store; `erp-read`, `erp-write`, `docs` servers deployed by Kustomize ([platform/mcp](../../../platform/mcp/)) | `scripts/local/mcp-verify.sh` lists each server's tools and runs one call per server (8 of 8 checks pass on k3d) |
| M3. Match engine | `platform/mcp/match-engine` with HPA | Unit tests for every exception type; load test shows HPA scaling on k3d |
| M4. Workflow | Steps 1–7, review gate, waits, reminders, queue fan-out | Time-skipping workflow tests: every route, timeouts, crash recovery |
| M5. Evals and demo | promptfoo suite on the labelled set; demo script | Success measures in the [business case](business-case.md#prototype-scope-and-success-measures) met |

## Open questions

- **LiteLLM MCP gateway** as a second allow-list layer: check on the pinned LiteLLM version after M1 ([ADR-0020](../../../docs/adr/0020-mcp-tools-and-skills.md)).
- ~~**MCP client in the AI SDK**~~ Settled in M1: agent-kit uses the official MCP SDK client (`@modelcontextprotocol/sdk` 1.32.2) and turns allowed tools into AI SDK tools itself, so the allow-list and call log sit in one place.
- ~~**Where documents live on GKE**~~ Settled in M2: the documents are generated, so they are built into the `mcp-docs` image. No volume, bucket or credential on either k3d or GKE.
