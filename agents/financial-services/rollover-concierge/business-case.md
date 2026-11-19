# Business case: Rollover Concierge

- **Category:** Business problem (retirement services)
- **Status:** Example application of exception resolution (pattern 1), over a multi-week process; not scheduled to build ([ADR-0019](../../../docs/adr/0019-pattern-agent-portfolio.md))
- **Users:** Retirement service representatives; customers indirectly, through approved outreach

## Summary

When people change jobs, they often want to move their old employer's 401(k) into an IRA at the firm. The process takes weeks: each old plan has its own forms and rules, checks are sometimes mailed, and tax deadlines apply if money is paid to the customer. Many customers start the process and never finish. The Rollover Concierge runs the whole process for a service representative: it works out what the old plan requires, pre-fills forms, tracks each step, sends reminders at the right moments and flags tax pitfalls. It provides service, not advice; any question about whether or how to roll over goes to a licensed professional.

## Business purpose

**The problem**

- Rollovers are one of the largest sources of new retirement assets, but they are slow and confusing. The customer has to deal with the old plan's administrator, who may require specific forms, notarized signatures, or a phone call.
- If the old plan pays the money to the customer rather than directly to the new IRA (an indirect rollover), the customer has **60 days** to deposit it or it becomes a taxable distribution, possibly with a penalty. The plan also withholds 20% for taxes, which the customer must make up from other funds to roll over the full amount.
- Representatives track each rollover by hand across weeks. Steps get missed, customers go quiet, and rollovers stall. Every stalled rollover is assets that stay with the old plan or are cashed out.

**What the agent does**

1. Starts when a customer requests a rollover (synthetic customer and plan data in the prototype).
2. Identifies the old plan's administrator and its requirements from a plan-rules library (synthetic plan documents in the prototype).
3. Pre-fills the new IRA application and the old plan's distribution request; lists anything the customer must supply.
4. Drafts a checklist and outreach message; **a representative approves** before anything is sent.
5. **Tracks the process durably over weeks:** waits for forms, checks for status, and sends reminders on a schedule set by the representative.
6. If money is paid to the customer, starts a **60-day deadline timer**, explains the 20% withholding in approved language, and escalates to the representative well before the deadline.
7. Confirms when funds arrive and are invested as the customer instructed, then closes the case with a full history.
8. Detects advice-seeking questions ("Should I roll over or leave it?", "What should I invest in?") and routes them to a licensed professional instead of answering.

## Value proposition

| Benefit | How it's measured |
|---|---|
| More rollovers completed | Share of started rollovers that complete |
| Faster completion | Days from request to funds received |
| Fewer tax problems for customers | Indirect rollovers that miss the 60-day deadline (target: zero) |
| Representatives handle more cases | Active rollovers per representative |
| Better customer experience | Satisfaction scores; "where is my rollover?" contacts |

No value model: the volumes, handling times and labor rates behind one are domain figures this project can't validate. A pilot would measure the benefits above against the operating unit's own baseline.

## Cost

| Item | Estimate |
|---|---|
| Model usage per rollover (whole multi-week case) | ~15 small `fast` steps (status checks, reminder drafts, document field extraction) + 1–2 `smart` steps (checklist, plan-rules interpretation): roughly 90,000 tokens in, 10,000 out ≈ **$0.05–0.08** |
| Waiting time | Free: weeks of waiting cost nothing in compute; Temporal stores the timer |
| Infrastructure | Shared platform cost (~$0.08–0.15/hour while the cluster is up) |
| Prototype build | ~2–3 weeks: workflow with timers, plan-rules library, form pre-fill, advice-detection classifier, eval suite, representative UI |
| **Monthly model cost at 1,000 rollovers** | ~$50–80 |

**Production cost drivers** (not in the prototype): connections to plan administrators and the recordkeeping platform, e-signature, secure customer messaging, and compliance review of all customer-facing language.

## Risks

| Risk | Impact | Likelihood |
|---|---|---|
| Agent gives investment or rollover advice (or appears to) | Regulatory breach of advice and best-interest obligations | Medium |
| Agent misstates a tax rule or deadline | Customer pays unexpected taxes or penalties; complaint; liability | Low–Medium |
| 60-day deadline is missed because a timer or escalation fails | Taxable distribution for the customer | Low |
| Plan requirements are wrong or out of date | Rejected paperwork; delays | Medium |
| Reminders are too frequent or sent through the wrong channel | Customer annoyance; communication-preference or consent violations | Medium |
| Customer data in forms is exposed or sent to the wrong party | Privacy breach | Low |

## Controls

| Control | Type | Addresses |
|---|---|---|
| Advice-detection step on every customer question; advice-seeking questions go to a licensed professional, never answered by the agent | Preventive | Advice |
| All customer-facing tax and rollover language comes from compliance-approved templates; the model fills in fields only | Preventive | Advice, tax misstatement |
| Deadline math is deterministic code, not the model; the model never calculates dates | Preventive | Missed or misstated deadline |
| Durable 60-day timer with escalations at fixed points (e.g., day 30, 45 and 55) to the representative and their supervisor | Detective | Missed deadline |
| Representative approves every outreach message and every form before it is sent | Preventive | Wrong content, wrong recipient |
| Plan-rules library entries carry a source and review date; stale entries are flagged before use | Detective | Outdated requirements |
| Reminder schedule and channel limited by the customer's stated preferences | Preventive | Over-contact |
| Eval suite: advice-seeking questions must be routed (target 100%); deadline scenarios must escalate on time | Detective | Advice, missed deadline regressions |

## Prototype scope and success measures

- **In scope:** synthetic customers and a library of 10–20 synthetic plan administrators with varied requirements; direct and indirect rollovers; durable tracking with reminders and deadline escalations; representative UI.
- **Out of scope:** real plan administrators or recordkeepers, real customer contact, investment selection, and Roth conversions or other tax-planning scenarios.
- **Success measures:** 100% of advice-seeking eval questions routed to a person; 100% of deadline scenarios escalate on schedule (tested with Temporal's time-skipping test environment); correct form requirements for ≥ 95% of plans in the library.
