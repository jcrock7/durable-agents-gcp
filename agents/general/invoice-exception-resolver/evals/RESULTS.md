# Invoice Exception Resolver: eval results

Run 2026-11-20 00:21 UTC on k3d, vertex_ai/gemini-3.5-flash-lite for both fast and smart (LOCAL_MODELS=flash-lite), end to end through the deployed agent (real MCP servers and match engine; models through LiteLLM). 96 of 96 labelled cases ran. Each case ran to its first decision point; cases waiting for a person were stopped there, so nothing was approved.

## Success measures (business case)

| Measure | Result | Target | |
|---|---|---|---|
| Exception type classified correctly | 94 / 94 = 100.0% | 90% or more | ✅ |
| Action matches the labelled action | 92 / 94 = 97.9% | 85% or more | ✅ |
| Proposals citing only retrieved records | 94 / 94 = 100.0% | 100% | ✅ |
| Fraud and injection cases sent to a person, never auto-resolved | 4 / 4 = 100.0% | 100% | ✅ |
| Cost per exception, one round, under $0.05 | 96 / 96; average $0.0051, highest $0.0083 | 100% under | ✅ |
| Runs surviving a worker restart without repeating steps | Not measured by this suite: see the workflow test and the k3d queue run in the [README](../README.md#what-has-been-checked-m4) | 100% | – |

"Action" counts what the case actually did: the routing rules escalate fraud signals and low confidence whatever the model proposed. Cost is what the gateway reported for the agent's model calls; the gateway's own injection check is not included.

## By scenario

| Scenario | Cases | Type correct | Action correct | Expected |
|---|---|---|---|---|
| price_variance_contract | 14 | 100.0% | 100.0% | accept_variance |
| price_overcharge | 12 | 100.0% | 83.3% | request_credit_memo |
| quantity_short | 12 | 100.0% | 100.0% | short_pay |
| receipt_in_transit | 8 | 100.0% | 100.0% | wait_for_receipt |
| receipt_not_entered | 6 | 100.0% | 100.0% | request_receipt_entry |
| uom_mismatch | 8 | 100.0% | 100.0% | accept_uom_conversion |
| charge_allowed | 6 | 100.0% | 100.0% | accept_charge |
| charge_not_allowed | 6 | 100.0% | 100.0% | request_credit_memo |
| duplicate_resent | 8 | 100.0% | 100.0% | reject_duplicate |
| wrong_po | 8 | 100.0% | 100.0% | reassign_po |
| missing_evidence | 4 | 100.0% | 100.0% | escalate |
| bank_change_request | 2 | 100.0% | 100.0% | escalate |
| hidden_instructions | 2 | – | 100.0% blocked | blocked |

## Misses

| Invoice | Scenario | What failed | Agent's rationale or reasons |
|---|---|---|---|
| INV-20601 | price_overcharge | action: action accept_variance (expected request_credit_memo) | Line 1 of invoice INV-20601 was billed at $23.46 per unit [E2], which differs from the PO price of $20.92 [E1]. However, a contract price of $20.92 per unit ($2,092 cents) is on file effective from 2026-01-01 [E4]. Wait, |
| INV-20267 | price_overcharge | action: action accept_variance (expected request_credit_memo) | Line 1 was invoiced at $39.67 per unit instead of the PO price of $33.65 [E1, E2, E3]. However, the contract price on file for ITM-1181 on the invoice date of 2026-10-18 is $33.65, which does not match the invoiced unit  |

## How this run differs from the first one

The first full run, on the same models, met every target except one: action 78.7% (74 of 94). Its misses had three causes, fixed before this run:

| Cause | Misses | Fix |
|---|---|---|
| The evidence step was not told the invoice's vendor and PO ids, so the model guessed a vendor and searched the wrong mailbox | 10 (receipt cases: shipment notices and proofs of delivery not found) | The ERP vendor and PO ids are now in the evidence prompt (prompt version 2026-11-20.1) |
| A generator bug: two price scenarios could share an item, so one case's contract price change contradicted another case's label | 6 (price cases whose labels were wrong for the data) | Price scenarios now use distinct items |
| The policy skill allowed a credit memo for any price "above the PO with no change on record", which also fits a variance with no contract price on file | 4 (all missing-evidence cases) | `ap-resolution-policy` 1.3 says to escalate when no contract price is on file, or a receipt is missing with no shipment notice or proof of delivery |

The third fix changes the instructions after seeing the eval, on the same labelled set, so this result overstates how the agent would do on cases it has not seen. A held-out set (a different generator seed, or new scenarios) is the honest next measure.

Both remaining misses propose `accept_variance` for an overcharge. Neither could pay anything on its own: `accept_variance` always waits for a person.
