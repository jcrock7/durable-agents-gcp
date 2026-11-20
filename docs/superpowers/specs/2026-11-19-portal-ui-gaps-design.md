# Agent portal: closing the remaining UI gaps

Status: proposed, awaiting approval. Builds on commit `bbc0f1f` (decision-first case page, overview, case queue).

## Intent

The portal is shown to Fortune 100 and private equity audiences. After the redesign, a reviewer can read a case in one screen, but several things on that screen are still guessed by the browser, missing, or wrong:

- The agent can recommend an action its own policy does not allow, and nothing stops it or tells the reviewer.
- The reviewer cannot see which options were weighed, which evidence is irrelevant, why a case is on hold, or what approving does to payment.
- Vendor, due date and line quantity are scraped from PDF text in the browser.
- There is no way to hand a case to a person, no search, no business figures, and the user chip does nothing.

The goal is that everything a reviewer sees is supplied by the system that knows it, and that the screen answers "should I approve, and what happens if I do" without a second source.

## Goals

1. A recommendation that conflicts with policy is caught by a workflow rule and shown as a conflict, with the action the policy points to.
2. The case page shows the options considered, labels evidence that does not apply, and quotes the policy version the run used.
3. Every status carries its reason: why on hold and who releases it, why cancelled and by whom.
4. The decision bar states the payment effect of approving.
5. A reviewer can escalate a case to an AP specialist with a note.
6. All Cases supports search, sort and paging over the full history.
7. The overview shows business figures computed from case data.
8. The user chip opens a small menu; research cases get a step strip; roadmap agents get a real page.
9. The portal works at phone width, has UI tests, and ADR-0021 and the design tokens describe what is built.

## Non-goals

- Tuning the agent's prompts or model choice so it recommends the right action more often. This design adds the rule that catches a wrong one; improving the hit rate is eval work for the agent.
- A cost comparison against manual processing. It needs a baseline cost per case that the business has to supply. The overview leaves a slot for it and shows nothing until a figure is configured.
- Assigning cases to named individuals, notifications, or role-based access. Escalation goes to the existing "Escalated" state, not to a person's inbox.
- New agents, or building the four roadmap agents.

## Anti-goals

- The browser must not parse documents or infer business facts. If the API does not supply a field, the UI omits it.
- No invented numbers. Every figure on the overview is a sum or median over real cases and says what it covers.
- The rule that checks policy fit must not depend on the model. It is plain code over the match engine's finding, like the existing routing rules.
- Nothing here may let a reviewer post to the ERP by a path that skips the existing approval rules.

## Constraints

- State shapes are owned by the agents (`CaseState` in `agents/general/invoice-exception-resolver/src/types.ts`). The API passes state through and builds `CaseSummary` in `summarize()` (`apps/api/src/app.ts`). New fields are added at the source and typed, not derived downstream.
- Routing is deterministic workflow code (`route.ts`, ADR-0020). Changes there need replay safety: use Temporal `patched()` for any new branch a running case could reach.
- The "review" update is shared (`packages/agent-kit/src/workflow/review.ts`). Extending it must stay backward compatible for the research agent.
- Old runs stay readable. Every new field is optional in the UI, and a missing field hides its element.
- Local toolchain: install and build through WSL (Windows `pnpm` cannot switch to the pinned version).

## Approaches

**A. By layer.** Change the agent contract, then the API, then the UI, in one pull request. Simple to reason about, but nothing is visible until the end and the diff is large.

**B. By reviewer outcome, in three slices (chosen).** Each slice cuts through agent, API and UI and can be deployed and demonstrated on its own:

1. *Trust the recommendation*: policy-fit rule, options considered, evidence relevance, policy text from the API, payment effect.
2. *Know what is happening*: structured invoice facts, hold and cancel reasons, full case history with search and sort, research step strip, roadmap agent page.
3. *Operate*: escalate to a person, user menu, business figures, phone layout, tests and docs.

Slice 1 fixes the one thing that would embarrass a demo (the agent contradicting its policy on screen). Each slice is small enough to review.

**C. UI only.** Keep deriving and parsing in the browser and add labels. Rejected: it is the current state, it cannot fix the policy conflict, and it breaks the first anti-goal.

My call, since you asked for a design to approve: B, in the order above.

## Design

### Slice 1: Trust the recommendation

**1.1 Policy-fit rule (agent, `route.ts`).** Add a deterministic check after the existing ones. The match engine already reports `contractSupportsInvoice`, `contractPriceCents` and the exception type per finding, so no model is involved.

| Proposed action | Conflict when | Policy points to |
|---|---|---|
| `accept_variance` | a price finding has `contractSupportsInvoice === false` and a contract price on file | `request_credit_memo` |
| `accept_variance` | a price finding has no contract price on file | `escalate` |
| `request_credit_memo` | `contractSupportsInvoice === true` | `accept_variance` |

A conflict adds a reason, `"accept_variance does not fit the policy: the invoiced price is above the contract price on file"`, forces `needsPerson: true`, and records `policyFit: { fits: false, expected: "request_credit_memo", why: string }` on `RouteDecision`. When it fits, `policyFit: { fits: true }`. The table lives in `route.ts` beside `PATHS`; other actions get rows only when the match engine exposes a field that settles them, otherwise `policyFit` is omitted.

**1.2 Options considered (agent, `ProposalSchema`).** Add `alternatives: Array<{ action: Action; whyNot: string }>` (zero to two entries) with the description "Other actions you weighed and why each fits the evidence less well". The prompt asks for it. The UI does not trust it for correctness; it is the agent's account, shown beside the rule's verdict.

**1.3 Evidence relevance (agent, `Evidence`).** Add `relevance?: "supports" | "contradicts" | "not_applicable"` and `relevanceNote?: string`, set by the smart model in the propose step as `evidenceNotes: Array<{ ref, relevance, note }>` on the proposal and copied onto the evidence items by the workflow. Uncited items with no note stay unlabelled.

**1.4 Policy text (API).** New `GET /api/agents/:id/skills/:name?version=` returning `{ name, version, actions: Array<{ action, useWhen, effect }>, alwaysPerson: string[] }`, parsed once at start from the agent's `SKILL.md` action table. The API image copies the agents' `skills` directories (the builder confirms how the worker packages them and reuses that). If the requested version is not the one on disk the endpoint returns 404 and the UI hides the policy block. The hard-coded `POLICY` map in `CaseView.tsx` is deleted.

**1.5 Payment effect (API and UI).** `Adjustment.payableCents` already says what becomes payable. The decision bar reads:

> **If you approve:** "Accept Variance" for $1,023.40 is written to the ERP, the exception is cleared, and the invoice becomes payable for $9,813.30.

For a hold path: "the invoice stays on hold and the message to the vendor is sent". For `payableCents: null`: no payment sentence.

**Case page after slice 1** (recommendation card):

```
AGENT RECOMMENDATION                      [■ Accept Variance · Medium Confidence]

[!] Conflicts with policy. The invoiced price is above the contract price on
    file. AP Resolution Policy 1.3 points to Request Credit Memo.

Line 1 of invoice INV-20267 shows an invoiced unit price of $39.67 … [E2]

Not confirmed. Could not confirm a vendor price change notice …

OPTIONS
  Agent proposed   Accept Variance       Policy: invoiced price is the contract price.  ✕ does not fit
  Policy fit       Request Credit Memo   Policy: billed above contract, no change on record.  ✓ fits
  Agent weighed    Escalate              "A contract price is on file, so the cause is clear."

AP RESOLUTION POLICY 1.3 · View full policy ›
```

Evidence cards gain a label on the right: `Supports`, `Contradicts`, or `Not Applicable · covers ITM-1187, a different item`.

When `policyFit.fits === false` the primary button changes to **Send Back to Agent** with the feedback pre-filled ("Policy points to Request Credit Memo"), and **Approve and Post to ERP** becomes the secondary button. Approval is still possible: the rule informs, the person decides.

### Slice 2: Know what is happening

**2.1 Structured invoice facts (API).** `GET /api/cases/:id` adds `facts: { vendorName, vendorId, dueDate, lines: Array<{ lineNo, itemId, description, quantity, unitPriceCents, poUnitPriceCents, contractPriceCents }> }`, taken from the ERP record the workflow already fetches with `erp-read:get_invoice` and stored on `CaseState.erpInvoice`. Not verified: whether that record carries the vendor name and line items. If it does not, the workflow adds one `erp-read` lookup for the vendor. The UI's PDF regexes and the quantity-from-division are deleted. The numbers card titles the line with item, description and quantity, e.g. "ITM-1181 · {description} · 170 units".

**2.2 Reasons on every status (agent and API).**
- On hold: `finish("on_hold")` passes a reason built from the route, e.g. "Waiting for a credit memo from the vendor. Released when the credit is recorded or a person re-checks." `CaseSummary` gains `reason: string` and `releasedBy: string`.
- Cancelled: `TemporalSource` gains a lookup of the run's termination event (reason and identity); `summarize()` sets `reason` to "Cancelled by {identity}: {reason}" or "Cancelled: no reason recorded".
- "What Happens Next" in the queue shows `reason` when present, else today's text.

**2.3 Case history (API and UI).** `GET /api/cases?agent=&state=&q=&sort=&cursor=&limit=` backed by Temporal visibility queries. `q` matches case reference and vendor (a `VendorName` search attribute set by the workflow). Sort by age, amount or cost. The table gets a search box, clickable column headers, an Amount column, and "Load more". The overview keeps using `/api/mission` for the last 25.

**2.4 Research step strip (agent and UI).** The research workflow records the same `timeline` entries the invoice agent does (Search, Read Sources, Draft, Review). `InvoiceCase`'s step strip is extracted to a shared `StepStrip` component and used by both.

**2.5 Roadmap agent page (UI).** Replaces the empty queue with: what it will do, the pattern it uses, the systems it will connect to, and its ADR reference, from the registry entry.

### Slice 3: Operate

**3.1 Escalate to a person (agent-kit, agent, API, UI).** `ReviewDecision` gains an optional `escalate: { note: string }`. The invoice workflow treats it as `holdAndFinish("escalated", [note, "escalated by {reviewer}"])`. Workflows that do not handle it reject the update with "this case cannot be escalated", which the UI shows. Decision bar:

```
[ Approve and Post to ERP ]  [ feedback… ]  [ Send Back to Agent ]  [ Escalate to AP Specialist ▾ ]
```

Escalate opens an inline note field and a confirm button; it never posts to the ERP.

**3.2 User menu (UI).** The chip becomes a button with a menu: signed-in identity, theme (Light, Dark, System), and "Sign out" only when the identity came from IAP (links to `/_gcp_iap/clear_login_cookie`). The separate theme button is removed. `/api/me` adds `source: "iap" | "local"`.

**3.3 Business figures (API and UI).** `/api/mission` adds `value`, computed over the cases it already loads and labelled with the window:

| Figure | Definition |
|---|---|
| Awaiting Decision | sum of `adjustment.amountCents` over cases needing a decision |
| Invoice Value Processed | sum of invoice totals over cases closed in the window |
| Closed Without a Person | closed cases with no `reviewer`, as a share of closed cases |
| Median Time to Proposal | median of first timeline entry to the "Propose" entry |
| Cost per Case | model spend in the window divided by cases started |

Shown as a second KPI row titled "Last {n} Cases". A sixth tile, "Against Manual Processing", renders only when `PORTAL_MANUAL_COST_PER_CASE_USD` is set.

**3.4 Phone layout (UI).** Below 720px: the sidebar becomes a top bar with a menu button; tables become stacked cards (reference, status, next step); the step strip becomes a vertical list; the decision bar stacks with the primary button full width. Checked at 390 × 844.

**3.5 Tests and docs.** Vitest and Testing Library for `caseGroup`, `plain`, `titleCase`, `StepStrip`, the policy-conflict state of the recommendation card, and the decision bar's three effect sentences. `route.test.ts` covers the policy-fit table. `app.test.ts` covers the new endpoints. ADR-0021 is amended to describe the three views and the removal of the Mission Control overlay; `docs/design/agent-portal/tokens.css` gains the added tokens (`--crit`, `--warn-fill`, `--bar`).

## Left to the builder

- Exact wording of rule reasons and reason strings, in the plain style already used.
- How the API locates skill files in its image.
- Component boundaries inside `apps/web` beyond `StepStrip`.
- Cursor format for case paging.
- Whether `VendorName` needs registering as a Temporal search attribute in the local and GKE overlays (it will; the mechanics are the builder's).

## Calls I made that you can overturn

1. Approving stays possible when the policy rule reports a conflict. The alternative is to block approval; I kept the person in charge.
2. Escalation goes to the "Escalated" state, not to a named person.
3. The manual-cost comparison is off until you supply a baseline figure.
4. Evidence relevance and alternatives come from the model and are shown as the agent's account; only the policy-fit verdict is deterministic.
5. Order of work: slice 1, then 2, then 3, each deployed to the local cluster when done.
