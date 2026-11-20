# Business case: Transfer Exception Resolver

- **Category:** Business problem (brokerage operations)
- **Status:** Example application of exception resolution (pattern 1); not scheduled to build ([ADR-0019](../../../docs/adr/0019-pattern-agent-portfolio.md))
- **Users:** Account-transfer operations specialists

## Summary

When a customer moves a brokerage account in from another firm, the transfer is often rejected: a name or Social Security number doesn't match, the account types differ, a holding can't be transferred, or a signature or document is missing. Each rejection is worked by hand, often over several days of back-and-forth with the customer and the other firm. The Transfer Exception Resolver diagnoses the rejection, prepares the fix and the customer outreach for a specialist to approve, waits for the customer's response, and resubmits. Specialists keep every decision; the agent removes the investigation and follow-up work.

## Business purpose

**The problem**

- Account transfers between US brokerages run through the industry's automated transfer system (ACATS). Industry rules set tight timelines once a transfer is submitted, so a rejection that sits in a queue quickly becomes a missed deadline and a frustrated customer.
- Rejections come back as reason codes that a specialist has to interpret. They then compare the firm's account record with the other firm's, decide the fix, contact the customer, wait, and resubmit.
- The customer is at their most impatient during a transfer: they have chosen to move their money to the firm and nothing has happened yet. A slow or confusing transfer is a common reason new customers give up or move back.

**What the agent does**

1. Receives a rejected transfer (from a synthetic rejection feed in the prototype).
2. Reads the reason code, the firm's new-account record and the other firm's account details, and identifies the most likely cause.
3. Proposes the fix: correct a data field, request a document, change the account type, or move a non-transferable holding out of the request.
4. Drafts the customer message (email or secure message) in plain language.
5. **Pauses for specialist approval** of both the fix and the message.
6. Sends the approved outreach, then **waits durably, for days if needed**, for the customer's documents or reply, with reminders on a schedule.
7. Validates what comes back, prepares the resubmission and **pauses for approval** again before resubmitting.
8. Closes the case with a full history of what was found, decided, approved and sent.

## Value proposition

| Benefit | How it's measured |
|---|---|
| Less specialist time per exception | Handling minutes per exception, before vs. after |
| Faster transfer completion | Days from rejection to completed transfer |
| Fewer repeat rejections | Share of resubmissions rejected again |
| Fewer customers who give up mid-transfer | Share of rejected transfers never completed |
| Consistent, documented handling | Share of cases with full decision history (target: 100%) |

No value model: the volumes, handling times and labor rates behind one are domain figures this project can't validate. A pilot would measure the benefits above against the operating unit's own baseline.

## Cost

| Item | Estimate |
|---|---|
| Model usage per exception | ~3 `fast` calls (diagnosis, validation) + 1 `smart` call (customer message): roughly 35,000 tokens in, 4,000 out ≈ **$0.03–0.05** |
| Waiting time | Free: a waiting Temporal workflow uses no compute, only a row in Temporal's database |
| Infrastructure | Shared platform cost (~$0.08–0.15/hour while the cluster is up) |
| Prototype build | ~2–3 weeks: workflow, 5–6 tools, synthetic rejection generator, eval suite, approval UI |
| **Monthly model cost at 2,000 exceptions** | ~$60–100 |

**Production cost drivers** (not in the prototype): integration with the transfer system and account-servicing platforms, secure customer messaging, and operations staff training.

## Risks

| Risk | Impact | Likelihood |
|---|---|---|
| Agent misdiagnoses the cause and proposes the wrong fix | Wasted cycle; repeat rejection; customer contacted twice | Medium |
| Customer message is inaccurate, confusing or off-brand | Customer complaint; reputational harm | Medium |
| Agent exposes another customer's data in a message (wrong record retrieved) | Privacy breach; regulatory notification | Low |
| Resubmission sent without the right documents or authority | Failed transfer; possible rules violation | Low |
| Workflow stalls silently while waiting for a customer | Missed timelines; transfer never completes | Medium |
| Customer-supplied documents contain injected instructions (e.g., text in a PDF) | Agent manipulated into a wrong action | Low |

## Controls

| Control | Type | Addresses |
|---|---|---|
| Specialist approves every fix, every customer message and every resubmission (Temporal approval signal) | Preventive | Wrong fix, bad message, unauthorized resubmission |
| Diagnosis must cite the reason code and the specific fields compared; no citation, no proposal | Preventive | Misdiagnosis |
| Agent tools are scoped to the one case's records; retrieval by case ID only | Preventive | Cross-customer data exposure |
| Approved message templates; the model fills in fields rather than writing freely | Preventive | Off-brand or inaccurate messages |
| Documents treated as data: extracted fields only, screened by the injection guardrail, never followed as instructions | Preventive | Injected instructions |
| Durable timers with escalation to a person when a deadline approaches or a customer doesn't respond | Detective | Silent stalls, missed timelines |
| Eval suite of labeled synthetic rejections (every reason code) gates changes | Detective | Misdiagnosis regressions |
| Full case history (inputs, proposals, approvals, sent messages) kept for audit | Detective | All |

## Prototype scope and success measures

- **In scope:** synthetic rejection feed covering the common reason codes; synthetic account records for both firms; diagnosis, outreach, waiting, validation and resubmission; approval UI.
- **Out of scope:** connection to any real transfer system, real customer contact, and non-standard transfers such as partial or in-kind transfers of unusual assets.
- **Success measures:** correct diagnosis on ≥ 90% of the labeled eval set; no message sent or resubmission made without approval (verified by test); a workflow survives a worker restart mid-wait and resumes on time.
