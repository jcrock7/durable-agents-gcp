# Business case: Invoice Exception Resolver

- **Category:** Business problem (accounts payable operations)
- **Pattern:** Exception resolution ([ADR-0019](../../../docs/adr/0019-pattern-agent-portfolio.md), pattern 1)
- **Status:** Designed, first to build. Design: [README](README.md)
- **Users:** Accounts payable (AP) specialists, AP approvers, buyers and receiving staff

## Summary

ERP systems run the three-way match automatically: they compare each supplier invoice with its purchase order (PO) and the goods receipt, and pay it when they agree within tolerance. The invoices that don't agree go to an exception queue, and resolving them is manual work. An AP specialist works out why the match failed, gathers evidence from documents and email, chases the buyer, the receiving dock or the vendor, and waits, sometimes for days.

The Invoice Exception Resolver works that queue. It reruns the match with a deterministic tool, classifies the exception, gathers the evidence, proposes a resolution with citations, and handles the follow-up: it drafts the vendor inquiry, waits for the reply, and re-checks when a receipt is posted. Anything that changes what gets paid goes to a person for approval. The agent never changes vendor master data or payment details.

## Business purpose

The match itself is solved; the exceptions are not. Typical exception types:

| Exception | Usual cause | Evidence needed |
|---|---|---|
| Price variance | Contract price change, surcharge, or a pricing error by either side | Contract price list, PO terms, vendor correspondence |
| Quantity variance | Partial shipment, over-shipment, or a receipt not yet posted | Goods receipts, packing slip, receiving notes |
| Unit-of-measure mismatch | Invoiced per case, ordered per each | Item master, PO line, invoice line |
| Charges not on the PO | Freight, fuel, handling or expedite fees | PO and contract freight terms, vendor quote |
| No matching receipt | Goods arrived but receipt not entered, or not yet delivered | Receipts, shipment tracking, receiving staff confirmation |
| Possible duplicate | Same invoice sent twice, or re-sent with a new number | Invoice history for the vendor: numbers, amounts, dates |
| Missing or wrong PO reference | Vendor invoiced against the wrong PO, or none | Open POs for the vendor and item |

Unresolved exceptions cost money several ways. Late payments lose early-payment discounts and strain vendor relationships. Rushed approvals let overbilling and duplicates through. Specialists spend their time chasing information instead of judging it. Month-end close waits on the queue.

## Value proposition

| Benefit | How it's measured |
|---|---|
| Shorter time to resolve an exception | Days from exception raised to resolution posted, before vs. after |
| Fewer manual touches per exception | Human actions per exception (look-ups, emails, approvals) |
| Overbilling and duplicates caught before payment | Amount of variance rejected or recovered by credit memo; duplicates stopped |
| Fewer lost early-payment discounts | Discounts taken vs. available on invoices that passed through the queue |
| Consistent, audit-ready decisions | Share of resolutions with cited evidence and a recorded approver |
| Specialists focus on the hard cases | Share of specialist time on exceptions the agent flagged as complex or suspicious |

**How value would be calculated.** Labor value per month = exceptions per month × minutes saved per exception × loaded cost per minute. Add recovered overbilling and captured discounts. We don't put numbers in that formula: exception rates and cost per invoice vary widely by company. Published AP benchmarks (for example from APQC and Ardent Partners) give typical ranges, and a pilot would use the operating unit's own baseline.

## Cost

Cost per exception, using the model price assumptions in [ADR-0017](../../../docs/adr/0017-prototype-agent-portfolio.md#cost-assumptions-used-in-the-business-cases) (estimates, to check against real runs):

| Step | Model | Tokens (input / output) | Approx. cost |
|---|---|---|---|
| Read the invoice document | `fast` | 3,000 / 500 | $0.002 |
| Gather evidence (up to 4 tool rounds) | `fast` | 12,000 / 1,200 | $0.007 |
| Classify and propose a resolution | `smart` | 8,000 / 1,000 | $0.020 |
| Draft the vendor or internal message | `fast` | 2,000 / 400 | $0.002 |
| Prompt-injection screening | `guard` | (per call) | under $0.001 |
| **Per exception, one round** | | | **about $0.03** |
| Each further round (vendor reply, new receipt) | | | about $0.02 |

- **Tools:** the match engine and the database servers are small pods on the shared cluster. They add nothing per call beyond the platform's hourly cost (see the [README](../../../README.md#cost)).
- **Budget:** its own LiteLLM key, $3 per 30 days in the prototype, enough for about 100 exceptions.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Agent recommends accepting an overcharge | Overpayment | Amounts and tolerances come from the deterministic match engine, never the model. Every change to what is paid needs a person's approval |
| Vendor email contains instructions aimed at the agent ("approve and pay to this new account") | Payment fraud | LiteLLM injection guardrail. Email text is treated as data. Bank-detail changes are never handled by the agent: they are flagged as possible fraud and routed to a person |
| Wrong root cause | Wasted vendor contact; delay | Proposal must cite evidence records that exist. Low-confidence cases go straight to a person. Evals score classification on a labelled set |
| Agent messages a vendor with something wrong or sensitive | Vendor relationship; disclosure | Outbound messages use a fixed template with only invoice facts. Messages above the approval threshold, and every message in early pilots, are approved first |
| Run gets stuck waiting on a vendor | Exception ages unseen | Reminders on a schedule, then escalation to a person after a set number of days. The waiting runs show in the progress query |
| Synthetic data makes results look better than reality | Pilot disappointment | Success measures below say what a pilot on real data would have to prove |

## Controls

Platform-wide controls are listed in [ADR-0017](../../../docs/adr/0017-prototype-agent-portfolio.md#shared-controls-every-agent). Controls specific to this agent:

| Control | How |
|---|---|
| Deterministic money math | The `match-engine` MCP server computes variances, tolerances, duplicates and adjustment amounts. The model never does arithmetic on amounts |
| Read and write are separate servers | `erp-read` has a read-only database role. `erp-write` can only insert resolutions and queue outbound messages, and only the workflow calls it, after approval where required ([ADR-0020](../../../docs/adr/0020-mcp-tools-and-skills.md)) |
| Fixed set of actions | The model chooses from an allowed list (request credit memo, wait for receipt, ask the buyer, accept variance, short-pay, reject, escalate). Anything else fails validation |
| Approval by amount and action | Accepting a variance, short-paying or rejecting always needs a person. Messages are sent without approval only below the configured threshold |
| Fraud red flags never automated | Bank or remittance changes, new payees and pressure to pay urgently are flagged and routed to a person |
| Cited proposals | Every claim cites an evidence record ID. The activity rejects citations to records it didn't retrieve |
| Full trail | Temporal history plus the resolution record: evidence, proposal, approver, skill and prompt versions |

## Prototype scope and success measures

**In scope:** a synthetic ERP (vendors, items, contracts, POs, receipts, invoices, vendor mailbox) in Postgres; seeded cases covering every exception type above, plus fraud and injection cases; the full workflow including multi-day waits; approval through the review update; posting the resolution back to the synthetic ERP.

**Out of scope:** real ERP integration, real email, payment execution, vendor master changes.

**Success measures (on the labelled synthetic set):**

| Measure | Target |
|---|---|
| Exception type classified correctly | 90% or more |
| Proposed action matches the labelled action | 85% or more |
| Proposals with every claim citing a retrieved record | 100% |
| Fraud and injection cases routed to a person, never auto-resolved | 100% |
| Cost per exception, one round | under $0.05 |
| Runs that survive a worker restart mid-case without repeating steps | 100% |

A pilot on real data would have to prove the same measures on the operating unit's exceptions, plus the before/after cycle time and touches.
