# Invoice Exception Resolver

> **Status: building.** M1 (MCP client, allow-list, tool loop, skill loader in [agent-kit](../../../packages/agent-kit/)), M2 (synthetic ERP, document store, and the `erp-read`, `erp-write` and `docs` MCP servers) and M3 (the match engine, scaling 1 to 10 replicas under load) are done, all in [platform/mcp](../../../platform/mcp/), and M4 (the workflow, approval, waits and queue) runs on k3d; M5, evals on the labelled cases, is next. This README is the design. It becomes the agent's normal README as each milestone lands. Why this agent: [business case](business-case.md). Where it fits: [ADR-0019](../../../docs/adr/0019-pattern-agent-portfolio.md). How tools and skills work: [ADR-0020](../../../docs/adr/0020-mcp-tools-and-skills.md).

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
| 1. Match | activity `runMatch` | `match-engine:run_match` (includes the duplicate check). If the invoice now matches, the case closes |
| 2. Read invoice | activity `readInvoice` (first round) | `docs:read_pdf_text` → `fast` (text in, structured fields out; text passes the gateway's injection check). The model also reports text addressed to the system (`untrusted-content`); if it finds any, the invoice is held and the case ends as `blocked` |
| 3. Gather evidence | activity `gatherEvidence`: a model-driven loop over read-only tools, at most 4 rounds | `fast` + the model-visible tools (`erp-read`, `docs`, `match-engine`). Evidence E1 is the match, E2 the invoice text, E3… each tool result the model asked for |
| 4. Propose | activity `proposeResolution` | `smart`, structured output. Citations checked against the evidence list; the amount comes from `match-engine:compute_adjustment`, never the model |
| 5. Route | workflow code ([`route.ts`](src/route.ts)) | Rules from `agent.config.ts`: fraud signals, `escalate` and low confidence go straight to a person (invoice held); `accept_variance`, `short_pay` and `reject_duplicate`, amounts over $1,000, uncited proposals and classifications the match engine disagrees with need approval |
| Review | Temporal update `review` (`ReviewGate`) | A person approves, or sends it back with feedback for a revised proposal (at most 2 revisions). No decision in 7 days: held, `expired` |
| Send message | activities `draftMessage` → `queueMessage` | `fast` + `vendor-correspondence` drafts it; `erp-write:queue_message` queues it, only after approval where needed |
| 6. Post | activity `postResolution` | `erp-write:post_resolution`, with the approver, the evidence references and the run id |
| 7. Confirm | activity `confirmInvoice` | `erp-read:get_invoice`: the ERP must now show the invoice resolved or on hold. (Re-running the match would still show the original variance: accepting a variance doesn't change the invoice) |
| Wait | workflow timers and signal `recheck` | For `wait_for_receipt` and `request_receipt_entry`: hold, re-match daily or at once on `recheck`, remind on days 3 and 7, escalate on day 10. When the receipt appears, a new round starts at step 1 (at most 3 rounds) |

## Tools

All tools are MCP servers in the cluster, one Deployment each, under `platform/mcp/` ([ADR-0020](../../../docs/adr/0020-mcp-tools-and-skills.md)).

| Server | Built from | Tools this agent may use | Who calls them | Credentials | Scales |
|---|---|---|---|---|---|
| `erp-read` ✅ | **Existing:** MCP Toolbox for Databases 1.15.0 (Postgres source, tools defined as parameterized SQL in [`tools.yaml`](../../../platform/mcp/erp-read/tools.yaml)) | `get_invoice`, `get_purchase_order`, `list_vendor_purchase_orders`, `get_receipts`, `get_vendor`, `get_item`, `get_contract_prices`, `get_invoice_history`, `search_vendor_messages`, `list_open_exceptions` | Model (inside `gatherEvidence`) and workflow | Postgres role `erp_reader`: `SELECT` only | 1 replica |
| `erp-write` ✅ | **Existing:** MCP Toolbox for Databases, second instance ([`tools.yaml`](../../../platform/mcp/erp-write/tools.yaml)) | `post_resolution`, `queue_message`, `set_invoice_hold` | **Workflow only**, never offered to the model | Postgres role `erp_writer`: `INSERT` on `resolutions` and `outbox`, `UPDATE` of invoice and exception `status` only | 1 replica |
| `docs` ✅ | **Custom** ([`apps/mcp-docs`](../../../apps/mcp-docs/)): the reference filesystem server is stdio-only, so this small Streamable HTTP server replaces it ([why](../../../platform/mcp/README.md#why-docs-is-custom)). The document store is built into its image | `list_directory`, `read_text_file`, `read_pdf_text`, `read_media_file` | Activities | None; no volume | 1 replica |
| `match-engine` ✅ | **Custom** ([`apps/mcp-match-engine`](../../../apps/mcp-match-engine/)): TypeScript, official MCP SDK, stateless; reads ERP data through `erp-read` | `run_match`, `check_duplicate`, `compute_adjustment` | Activities and workflow | None: pure computation over inputs plus `erp-read` data | **HorizontalPodAutoscaler** on CPU, 1–10 replicas. The queue fan-out shows it scaling |

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

## Configuration ([`agent.config.ts`](src/agent.config.ts))

| Setting | Prototype value | Meaning |
|---|---|---|
| `models` | `extract: fast`, `evidence: fast`, `propose: smart`, `draft: fast` | LiteLLM aliases per step |
| `tools` | The `server:tool` pairs in the table above; `erp-write` tools are `workflowOnly` | Allow-list. The MCP client drops anything else and keeps write tools from the model |
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

`status`: `resolved` (posted and confirmed in the ERP), `on_hold` (posted with the invoice held, for example awaiting a credit memo), `escalated` (handed to a person with the invoice held: fraud signal, low confidence, missing evidence, no receipt after 10 days, or out of rounds), `rejected_by_reviewer`, `blocked` (guardrail, or instructions found in the invoice), `expired` (no reviewer within 7 days).

It also carries: exception type, action taken, amount (from `match-engine`), cited evidence references, approver, rounds, human touches, tool calls, tokens per step, and skill and prompt versions. While it runs, the `caseState` query returns everything the portal's case view shows: stage, timeline, match findings, evidence, proposal, route and reasons, the queued message, every tool call record, skill versions and token usage.

Workflow ids: a case is `inv-<number>` (INV-20931 → `inv-20931`), the ids the portal shows.

## Run it

On k3d after `scripts/local/apply-k8s.sh`, with the Temporal CLI inside the Temporal pod:

```bash
T="kubectl -n agents exec temporal-0 -- temporal"

# One case
$T workflow start --task-queue invoice-exception-resolver --type resolveInvoiceException --workflow-id inv-20931 \
  --input '{"exceptionId":"EX-3000","invoiceId":"INV-20931"}'
$T workflow query --workflow-id inv-20931 --name caseState -o json | jq '.queryResult[0] | {stage, status, route, timeline}'

# Approve, or send back with feedback
$T workflow update execute --workflow-id inv-20931 --name review --input '{"approved":true,"reviewer":"ap.lead"}'
$T workflow update execute --workflow-id inv-20931 --name review --input '{"approved":false,"feedback":"Ask for a credit memo instead","reviewer":"ap.lead"}'

# The queue: every open exception, at most 10 being worked at once
$T workflow start --task-queue invoice-exception-resolver --type resolveExceptionQueue --workflow-id exception-queue-1 --input '{"limit":50}'

# The outside world: a receipt arrives, or the vendor replies (the case re-checks at once)
scripts/local/erp-event.sh receipt INV-20123
scripts/local/erp-event.sh reply INV-20123 "The goods were delivered on 12 Nov."

# Start again from the seeded ERP
scripts/local/erp-load.sh
```

The queue gives a case's slot back as soon as the case waits (for a person or a receipt) or finishes, so long waits never block it, and it finishes once every case has reached that point. Cases outlive the queue.

**Models.** With `LOCAL_MODELS=mock` the gateway answers with the smallest valid object for each schema, so every case proposes `accept_variance` with no valid citations and waits for review. That exercises the workflow, tools, approvals, durability and the ERP writes, but not judgment. `LOCAL_MODELS=flash-lite` or `full` uses Gemini through the same gateway; the quality of the proposals is what M5's evals measure.

## What has been checked (M4)

- **Workflow tests** ([`test/workflow.test.ts`](test/workflow.test.ts), Temporal's time-skipping server, activities mocked): post without a person; approval of an over-threshold variance with the approver recorded; send-back and revision; rejection after too many send-backs; 7-day expiry; low confidence and fraud signals escalated without approval; instructions in the PDF and a gateway guardrail block both end as `blocked` with the invoice held; uncited proposals sent to a person; an invoice that already matches closes at once; the receipt wait (daily re-match, the `recheck` signal, reminders on days 3 and 7, escalation on day 10, a second round when the receipt appears); a worker restart mid-case with no finished step repeated; the queue fanning out 12 cases that outlive it. Plus unit tests for the routing rules and citation checks.
- **On k3d, with the real MCP servers and the mock models:** INV-20931 went match → read → evidence → propose → route (to a person: the action, the $1,284.00 amount and the uncited proposal) → approval → post → confirm, and the ERP shows it resolved with the approver and run id. A 20-case queue ran with the worker pod deleted mid-run; all 20 reached review on the replacement pod. The four skills load from the worker image.

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
| M3. Match engine ✅ | `platform/mcp/match-engine` with HPA | Unit tests for every exception type (96 of 96 seeded cases, 892 clean invoices match); `scripts/local/match-engine-load.sh` scaled 1 → 10 replicas on k3d with no errors ([results](../../../platform/mcp/README.md#match-engine-the-deterministic-part-and-the-part-that-scales)) |
| M4. Workflow ✅ | Steps 1–7, review gate, waits, reminders, queue fan-out, skills | Time-skipping workflow tests: every route, timeouts, crash recovery ([what was checked](#what-has-been-checked-m4)) |
| M5. Evals and demo | promptfoo suite on the labelled set; demo script | Success measures in the [business case](business-case.md#prototype-scope-and-success-measures) met |

## Open questions

- **LiteLLM MCP gateway** as a second allow-list layer: check on the pinned LiteLLM version after M1 ([ADR-0020](../../../docs/adr/0020-mcp-tools-and-skills.md)).
- ~~**MCP client in the AI SDK**~~ Settled in M1: agent-kit uses the official MCP SDK client (`@modelcontextprotocol/sdk` 1.32.2) and turns allowed tools into AI SDK tools itself, so the allow-list and call log sit in one place.
- ~~**Where documents live on GKE**~~ Settled in M2: the documents are generated, so they are built into the `mcp-docs` image. No volume, bucket or credential on either k3d or GKE.
