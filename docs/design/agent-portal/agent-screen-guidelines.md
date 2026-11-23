# Agent screen guidelines

Every agent in the portal looks the same and speaks its own language. The **shared layer** (palette, type, surfaces, components, marks) is identical on every screen, so the portal reads as one product. The **domain layer** (words, record fields, block order, figures) belongs to each agent, so an invoice agent talks like accounts payable and an incident agent talks like an on-call engineer.

The look comes from auditors' working papers: one ruled sheet per page, figures in a ruled column, and a small pencil mark beside every figure saying how it is known. The working-paper *look* is shared. The accounting *words* (exceptions, schedules, evidence, footing) are not: they belong only to finance agents.

Status (22 Nov 2026): built. The main panel uses the working-paper look, and [DESIGN.md](../../../DESIGN.md) records the system as built. In code: shared parts in `apps/web/src/sheet.tsx`, `CaseParts.tsx` and `vocab.ts`; each agent's domain layer in `apps/web/src/domain/<agent>.tsx`; its words and page recipe in `apps/api/src/registry.ts`; and `apps/web/test/domain-words.test.ts` enforces the No Hard-Coded Domain Rule.

## The two layers

| | Shared layer: same on every screen | Domain layer: set per agent |
|---|---|---|
| **Look** | Palette, type, the sheet, rules, spacing, radii | Nothing: an agent cannot add colours, surfaces or fonts |
| **Components** | Sheet header, decision queue, record facts, proposal, sources, figures, stops, steps, mark legend, decision bar, run record | Which blocks appear, in what order, main column or margin |
| **Marks** | The four glyphs, their colour and their core meaning | The name of the rule a ◇ mark checks against |
| **Words** | Neutral portal words (case, decision, agent, run, rule, source) | The labels each block shows on that agent's screens |
| **Data** | How figures, totals and absences are drawn | Which figures exist and what the record's fields are |

## Where each voice speaks

**The Neutral Portal Rule.** Screens that mix agents use only neutral words: the rail, Overview, All Cases and Needs Decision. A case there is a *case*, its supporting material is *sources*, a stop is a *rule stop*. No finance, security or SRE term appears in the portal's own words (headings, labels, buttons, basis lines) on a screen that lists more than one agent's work.

What an agent recorded is shown as recorded. A case title, a routing reason or a rule name the run wrote ("Price variance", "$1,284.00 is over the $1,000.00 approval line") appears in that agent's own words wherever the case appears, always beside the agent's name, because rewording it would change the record. A block of one agent's figures on a shared screen is titled with the agent's name, and its labels stay neutral.

**The Domain Voice Rule.** Screens that belong to one agent speak that agent's language: the agent page, its case page and its Live Run view. Labels come from the agent's vocabulary, never from text written inside a shared component.

**The No Hard-Coded Domain Rule.** A shared component holds no domain word. It takes every label from the vocabulary of the agent it is rendering, with the neutral word as the fallback. A test fails the build if a shared component contains a domain term (for example *invoice*, *exception*, *evidence*, *schedule*, *CVE*, *incident*).

## Shared layer

### Surfaces

- **The Sheet Rule.** Each page in the main panel is one sheet: a single paper surface on the desk, divided by hairline rules and headings. No cards, no boxes inside the sheet, no grey page full of white panels.
- **The One Tint Rule.** At most one tinted area per screen, and only for the thing waiting on a person. Verdicts are stated once, as a word with a status marker, never as stacked coloured boxes.
- **The Ink Rule.** The rail's ink reaches into the main panel in exactly two places: primary buttons and the decision bar. Nothing else in the panel uses the rail's colour as a fill.
- Section titles are 17px title case. Small uppercase labels are kept for table column heads and the rail only.

### Palette

| Token | Light | Dark | Job |
|---|---|---|---|
| `desk` | #E9EEE6 | #0F1412 | Ground behind the sheet |
| `sheet` | #FBFCF8 | #161C19 | The page surface |
| `rule` | #C9D4C3 | #2E3A34 | Section and row rules |
| `rule-faint` | #DCE4D7 | #222B27 | Rows inside a table |
| `text` | #1D2420 | #E3E9E4 | Body and figures |
| `text-2` | #4A564E | #A9B5AD | Supporting text |
| `ink` | #161B22 | #E3E9E4 (button text #161B22) | Primary buttons, decision bar, heavy rule under the sheet header |
| `pencil` | #B23A2B | #E0786A | Marks only |
| `decision-amber` | #E39A1B | #E39A1B | The marker for "waiting on a person", nothing else |
| `held-slate` | #8FA3BF | #8FA3BF | Held and settled states |
| `done-green` | #1E7A34 | #6DD58C | Done or approved states |
| `stop-red` | #A8281F | #F0958C | A rule stopped the agent |
| `link` | #0B5CAD | #86B8F4 | Links and source citations only |

The rail keeps its current tokens unchanged.

### Type

IBM Plex Sans throughout, tabular figures everywhere digits line up. Scale: 24 sheet title · 17 section title · 16 decision and figure emphasis · 15 body · 13.5 supporting · 13 marks and table heads. No serif, no mono except raw output in the run record.

### Marks

Every figure on a sheet carries one mark, drawn small in pencil beside it. The glyph and its core meaning never change between agents. A pinned legend on each sheet says what the marks on that sheet mean.

| Mark | Core meaning (fixed) | What the domain may add |
|---|---|---|
| ✓ | Recorded by a run, shown as recorded | Nothing |
| ⊕ | Totalled from the records it covers | Nothing |
| ◇ | Checked against a rule | The rule's name: approval line, severity threshold, change window, budget |
| — | Not recorded, shown as absent | Nothing |

**The Mark Rule.** Marks are glyphs at 13px, never fills, never badges, and never the only carrier of meaning. Stop-red appears only as a filled square marker beside a word, so pencil and stop never look alike.

### Components

All of these are shared and take their labels from the agent's vocabulary. Neutral names are used in code and as the fallback label.

| Component (neutral name) | What it is |
|---|---|
| Sheet header | Sheet title, the prepared line ("Prepared by the runs · decided by you"), the record reference |
| Decision queue | Cases waiting on a person: amber marker, title, why it is waiting, amount or size, Review |
| Record facts | One ruled row of the record's key fields |
| Proposal | What the agent proposes, its reasoning, source citations inline |
| Sources | What the agent gathered, each cited or not, each with the agent's note |
| Figures | A ruled table of figures with their marks; an optional total row, double-ruled |
| Rule stops | Where a rule stopped the agent or a person overrode one |
| Steps | The run told as chapters and steps |
| Mark legend | The pinned legend for the marks on this sheet |
| Decision bar | The ink band with the consequence sentence and the decision buttons |
| Run record | Tool calls, skills, cost and guardrails, for the technical reader |

## Domain layer

### Vocabulary

Each agent declares labels for the components it uses; anything it leaves out falls back to the neutral word. The four columns on the right are examples of how the same component reads in different domains.

| Neutral word | Invoice Resolver (accounts payable) | Research Analyst | Vulnerability Patcher (security) | Incident Commander (SRE) |
|---|---|---|---|---|
| Case | Invoice | Brief | Vulnerability | Incident |
| Sources | Evidence | Sources | Findings | Signals |
| Citation prefix | E1, E2 | S1, S2 | F1, F2 | G1, G2 |
| Figures | Schedule A | Coverage | Exposure | Impact |
| Rule stops | Exceptions noted | Held for review | Policy blocks | Guardrail stops |
| Proposal | Proposed resolution | Draft brief | Proposed patch | Proposed fix |
| Approve action | Approve and Post to ERP | Approve Brief | Approve and Open PR | Approve and Run |
| ◇ rule name | Approval line | Citation rule | Severity threshold | Change window |

Audit Collector and Cost Sentinel declare their own columns when they are built (an IT audit agent may rightly use *evidence*; a cost agent may rightly use *variance*). A domain word is allowed wherever it is that domain's own word.

### Layout

Each agent declares a page recipe for its agent page and its case page: which shared components appear, in what order, and whether each sits in the main column or the margin column. The sheet grid is the same everywhere: a main column about two thirds wide and a margin column for the mark legend, routing and run figures.

- An agent may leave a component out, reorder components and choose its record fields and figures.
- An agent may add a domain block only when it is built from shared components and tokens (for example an incident timeline drawn as steps, or a dependency list drawn as a figures table).
- An agent may not add colours, surfaces, fonts, cards, tinted callouts or a second primary action.

### Where it lives

The agent registry (`apps/api/src/registry.ts`) is the home for both: a `vocabulary` map (neutral word to label) and a `layout` recipe per screen. The portal reads them through the agents API, so adding an agent never touches a shared component.

## Checklist for a new agent screen

1. Uses the shared tokens and components only; no new colour, font or surface.
2. Every label comes from the agent's vocabulary or the neutral fallback; nothing domain-specific is typed into a shared component.
3. Screens that list several agents use neutral words only.
4. Every figure has a mark, and the sheet shows the mark legend.
5. One tinted area at most, for the thing waiting on a person; the rail's ink only in buttons and the decision bar.
6. The decision bar states what approving, sending back or escalating will do, in the domain's words.
