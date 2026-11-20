---
name: three-way-match-exceptions
description: The invoice exception types, the evidence that settles each one, and what a well-supported proposal cites.
version: "1.0"
---

# Three-way-match exceptions

The match engine has already compared the invoice, the PO and the goods receipts, and reported findings with amounts. Your job is to find out **why**, from evidence, and to cite it. The match engine's amounts are final: never recompute money.

## Exception types and the evidence that settles them

| Type | Finding codes | Settle it with |
|---|---|---|
| `price_variance` | `PRICE_VARIANCE` | `erp-read:get_contract_prices` for the item: does a contract price in effect on the invoice date equal the invoiced price? Then `erp-read:search_vendor_messages` for a price change notice. The PO price alone does not settle it |
| `quantity_variance` | `QUANTITY_OVER_RECEIVED` | `erp-read:get_receipts`: how many units were received per PO line. Look for a backorder or partial shipment notice in the vendor's messages |
| `uom_mismatch` | `UOM_CONVERTIBLE` | `erp-read:get_item`: units per case. The finding already confirms the converted amount equals the PO line |
| `unplanned_charge` | `CHARGE_ALLOWED`, `CHARGE_NOT_ALLOWED` | `erp-read:get_vendor`: freight terms (`prepaid` means freight may not be billed; `add` means it may, up to the cap) |
| `no_receipt` | `NO_RECEIPT` | `erp-read:search_vendor_messages` for a shipment notice (in transit, expected date) or a proof of delivery (delivered and signed for, but never received in the ERP) |
| `duplicate` | `DUPLICATE_SUSPECT` | `match-engine:check_duplicate` and `erp-read:get_invoice_history`: an earlier invoice with the same PO and amount, or the same number with a re-send suffix, already paid |
| `wrong_po` | `PO_MISMATCH` | The finding's candidate POs, then `erp-read:get_purchase_order` on the candidate: same items and quantities, still open |

`BANK_DETAILS_CHANGED` is not an exception type. It is a fraud signal and always goes to a person, whatever else the case shows.

## Gathering evidence

- Start from the match findings. Make only the calls that answer the open question; four rounds at most.
- Search messages with specific words: the PO number, the item, "price", "delivery", "shipped", "resend".
- If the evidence that would settle the case does not exist (no contract price, no message, no receipt, no candidate PO), say so. Missing evidence is a finding, not a reason to guess.

## A well-supported proposal

- States the cause in one or two sentences.
- Cites every factual claim with an evidence reference such as [E2]. Each reference points to one tool result.
- Uses the match engine's amounts.
- Says what it could not confirm.
