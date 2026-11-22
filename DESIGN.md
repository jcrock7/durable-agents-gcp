---
name: Agent Operations
description: A decision-first case portal for AI agents, flat, ruled and quietly confident.
colors:
  action-blue: "#0B5CAD"
  action-blue-hover: "#08467F"
  action-blue-wash: "#E8F0FA"
  on-action: "#FFFFFF"
  desk-grey: "#F2F4F7"
  paper: "#FFFFFF"
  paper-shade: "#F7F8FA"
  row-hover: "#EEF1F4"
  rule: "#DDE1E6"
  rule-strong: "#C1C7CD"
  ink: "#161B22"
  ink-2: "#454C55"
  ink-3: "#5A626C"
  bar-slate: "#8FA3BF"
  track: "#E3E7EB"
  resolved-green: "#1E7A34"
  resolved-green-wash: "#EEF7F0"
  resolved-green-line: "#B7DFC1"
  info-wash: "#EDF3FB"
  info-line: "#B9D0EE"
  decision-amber-text: "#8F4C00"
  decision-amber-wash: "#FDF4E7"
  decision-amber-line: "#EDCB97"
  decision-amber: "#E39A1B"
  on-amber: "#1B1200"
  stop-red: "#A8281F"
  stop-red-wash: "#FBE9E7"
  idle-wash: "#F2F4F6"
  idle-line: "#D5D9DE"
  rail: "#161B22"
  rail-line: "#2C333C"
  rail-text: "#C9D0D8"
  rail-muted: "#9CA3AF"
  rail-ink: "#FFFFFF"
  rail-control: "#39414B"
  rail-ok: "#6DD58C"
  rail-idle: "#9CA3AF"
  rail-off: "#4B5563"
  rail-down: "#F0958C"
typography:
  display:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "clamp(22px, 2.6vw, 28px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  figure-sm:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  agent-name:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  dialog-title:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
  title:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  body-reading:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  supporting:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    note: "Steps of 14.5px (bar and dialog sentences, evidence), 14px (sub-lines, legends), 13.5px (meta and counts)"
  caption:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    note: "13px audit rows and footer; 12px engine history and small tags"
  rail-badge:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    note: "Monograms and collapsed-rail counts at 11px; sidebar group labels at 11.5px"
  label:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.08em"
  mono:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
rounded:
  marker: "2px"
  tag: "4px"
  control: "6px"
  panel: "8px"
  dialog: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  card-x: "22px"
  section: "24px"
  page: "28px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  button-sm:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  status-tag:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "3px 10px 3px 8px"
  status-tag-solid:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.tag}"
    padding: "5px 12px 5px 10px"
  citation:
    backgroundColor: "{colors.action-blue-wash}"
    textColor: "{colors.action-blue}"
    typography: "{typography.mono}"
    rounded: "3px"
    padding: "1px 5px"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "20px 22px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  nav-item:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-text}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "40px"
  nav-item-current:
    backgroundColor: "{colors.rail-line}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.control}"
  decision-band:
    backgroundColor: "{colors.decision-amber-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "18px 22px"
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "22px 24px"
    width: "min(640px, calc(100vw - 32px))"
---

# Design System: Agent Operations

## Overview

**Creative North Star: "The Case File"**

Every screen reads like a well-kept case folder. The decision sits on top: what was found, what the agent recommends, and what approving will do. Evidence, the policy that applies and the options the agent weighed are clipped directly behind it, and the full audit trail is at the back for anyone who wants to check. Nothing in the folder is there for show.

The voice is quietly confident. Authority comes from alignment, ruled lines and exact numbers, with a little warmth in the copy and generous enough spacing that it does not feel like a compliance tool. Surfaces are flat white paper on a cool grey desk, separated by thin rules. Colour is scarce and always means something: one blue for action, a small set of status colours, and a per-agent identity colour.

The system rejects two looks by name. It is not the pill-bubble AI look: no rounded pill chips, gradients, glows or sparkle icons. And it is not a chatbot: agents are presented through cases, steps and decisions, never as chat personas or conversations.

**The Step Record Rule.** Anything the run says about itself, including the Live Run feed's narration, is a third-person step record ("Found contract amendment 07…", "Invoice put on hold: …"), never "I" or "we", and appears whole as it arrives, with no typing animation.

**Key Characteristics:**
- Decision first, proof one drill-down away.
- Flat ruled surfaces; depth only where something floats.
- Squared 8px status markers in place of coloured pills.
- One accent blue; status colours carry status and nothing else.
- Tabular numerals everywhere, so figures align down a column.
- Light and dark themes from one token set.

## Colors

A cool neutral desk with a single working blue, and status colours used strictly as signals.

### Primary
- **Action Blue** (`action-blue`): the one accent. Primary buttons, links, the selected tab and selected step underline, progress fills, focus rings. Hover deepens to `action-blue-hover`; `action-blue-wash` backs citation tags, selected segments and selected rows.

### Secondary
- **Decision Amber** (`decision-amber`): the colour of "a person is needed". Fills the Needs Decision marker, the sidebar count, the current step, variance bars and over-budget tracks. It always carries dark text (`on-amber`). Text and borders on amber washes use `decision-amber-text` and `decision-amber-line`.

### Tertiary
- **Resolved Green** (`resolved-green`): done and fits-policy states, with its wash and line for the "Fits" option row.
- **Stop Red** (`stop-red`): a rule stopped the agent, an escalation, or a conflict with policy. Used for markers and short verdict text, with `stop-red-wash` behind the conflicting option.
- **Bar Slate** (`bar-slate`): the neutral fill for comparison bars and the On Hold segment, so amber stays reserved for the part that is over.

### Neutral
- **Desk Grey** (`desk-grey`): the page background.
- **Paper** (`paper`) and **Paper Shade** (`paper-shade`): panels, and the slightly recessed surface for evidence cards, table headers within a panel and hovered steps.
- **Rule** (`rule`) and **Rule Strong** (`rule-strong`): dividers and panel borders; the stronger rule outlines controls and sits under table headers.
- **Ink** (`ink`, `ink-2`, `ink-3`): primary text, secondary text, and labels or meta.
- **Rail** (`rail`, `rail-line`, `rail-text`, `rail-muted`, `rail-ink`, `rail-control`): the dark sidebar, which stays dark in both themes, so its tokens are set once. Status dots on the rail use `rail-ok`, `decision-amber`, `rail-idle`, `rail-off` (roadmap) and `rail-down`, lighter values chosen to read on the dark rail. No colour on the rail is written inline.

Dark theme values for every token live in `docs/design/agent-portal/tokens.css` under `.app[data-theme="dark"]`. Agent identity colours are defined in the same file as `--agent-<id>` pairs.

### Named Rules
**The Signal Rule.** Status colours appear only where a status is being reported. Never tint a heading, icon or panel in green, amber or red for emphasis.

**The Identity Rule.** Agent colours identify an agent and are never used for status.

**The Shape Rule.** A status marker never relies on colour alone. In rule lists a filled square means a rule requires a person, a diamond a conflict or stop, a tick a check that passed, and an outline a note; each also carries a visually hidden text label.

## Typography

**Display Font:** IBM Plex Sans (with system-ui, sans-serif)
**Body Font:** IBM Plex Sans (with system-ui, sans-serif)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace)

**Character:** One humanist-engineered sans does all the work at three weights (400, 500, 600). It reads as considered and technical without feeling cold, and its tabular figures keep money and counts aligned.

### Hierarchy
- **Display** (600, 34px, 1.1, -0.02em): the headline amount on a case.
- **Figure** (600, 30px) for KPI tiles and **Figure Small** (600, 24px) for agent header figures.
- **Headline** (600, clamp 22–28px, 1.2, -0.01em, balanced wrap): the question a case page asks. **Agent Name** is the same style fixed at 26px.
- **Dialog Title** (600, 20px): the decision dialog's heading.
- **Title** (600, 18px): the decision band's subject and the Live Run case reference; drill-down headings use 16px.
- **Body** (400, 15px, 1.5): everything else, tables included.
- **Supporting** (400, 14.5 / 14 / 13.5px): the decision bar and dialog sentences and evidence cards (14.5), sub-lines and legends (14), meta and counts (13.5). These three steps are the whole supporting ramp; do not add sizes between them.
- **Caption** (13px, 12px): audit-trail rows, the footer, the engine history and small tags.
- **Rail Badge** (600, 11px; group labels 11.5px): monograms and collapsed-rail counts only.
- **Body Reading** (400, 16px, 1.6, max 76ch): the agent's recommendation and other prose meant to be read in full.
- **Label** (600, 12.5px, 0.08em, uppercase): section labels, table headers, definition terms. Sidebar group labels use 11.5px.
- **Mono** (500, 12px): citation tags such as `E1`, and raw tool output in the audit trail (12.5px).

Weights are 400, 500 and 600 only; 650 and 700 are not used.

### Named Rules
**The Title Case Rule.** Labels in titles, tabs, headings, buttons and tags use title case ("Needs Decision", "Send Back to Agent"). Sentences stay in sentence case.

**The Mono Rule.** Mono is reserved for citation tags and identifiers or raw output in the audit trail. Never set amounts, headings or body copy in mono.

## Layout

A fixed dark rail (236px, collapsing to 68px) beside a fluid main column: a 56px top bar with the breadcrumb and user chip, the page, and a footer carrying the synthetic-data notice. The page uses the full available width with 28px padding and a 24px gap between sections.

Content is arranged with intrinsic grids, so it reflows without a fixed column count: key figures at a 180px minimum, header facts at 130px, step strip cells at 150px, paired overview panels at 320px with equal heights. The case page uses a 1.7fr / 1fr split for the story and its supporting facts. Panels pad 20px by 22px; table cells 12px by 18px.

The decision bar is pinned to the bottom of the case page so the choice is always in reach. At every desktop width the full sentence of what approving does has its own row (at most 72ch), consequence first, never cut; a conflict adds a short red tag before it ("Policy check: Send Back"). The buttons and "Recorded as" share the row below.

The Live Run view opens beside the collapsed rail (68px), so navigation stays where it is on every page; on a phone it takes the full screen with a Back to Case link.

Responsive behaviour:
- **At 900px and below** the rail collapses to icons and page padding drops to 18px.
- **When the case list's own panel is under 1000px** (a container query, so the sidebar is counted) the case list reads as cards, as on a phone (case, agent and type, status, what happens next, then figures), with a Sort menu in place of the column headers, so nothing scrolls sideways on a laptop or projector. Research rows lead with their question. Evidence drops to one column whenever its column is under about 640px.
- **Between 721px and 1100px** other tables drop their optional columns (runs, evals).
- **At 720px and below** the rail becomes a top strip with a short label under each icon (Overview, Decide, Cases, the agent's first name, Health), the breadcrumb shows only the last two crumbs, tables stack into labelled rows, the option rows and step drill-down go single column, the user menu spans the width, and the decision bar unpins with full-width buttons.
- **At 640px and below** the decision dialog becomes a bottom sheet.

## Elevation & Depth

Flat by default. Surfaces sit on the desk and are separated by 1px rules and a small shift in tone (Paper on Desk Grey, Paper Shade inside Paper). Hover is a tone change, never a lift.

### Shadow Vocabulary
- **Floating menu** (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18)`): the user menu.
- **Dialog** (`box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3)` over a `rgba(10, 16, 24, 0.55)` backdrop): the decision dialog.
- **Docked drawer** (`box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.18)`): the live run view's event drawer.

### Named Rules
**The Floats-Only Rule.** A shadow means the element is floating above the page and can be dismissed. Panels, cards, tiles and buttons never carry one.

## Shapes

Squared and modest. The radius grows with the size of the thing: 2px for status markers and legend swatches, 4px for tags and code blocks, 6px for buttons, inputs, notices and nav items, 8px for panels and the step strip, 10px for the dialog. Borders are always 1px; a dashed border marks something not yet real (roadmap agents). The only circles are the numbered step dots.

**The Square Marker Rule.** Status is a small squared marker (8px, 2px radius) beside a text label inside a 4px-radius tag. It is never a fully rounded pill.

## Components

### Buttons
Plain and decisive, sized for a pointer or a finger.
- **Shape:** softly squared (6px), 44px tall, 18px side padding, 600 weight at 15px. A small variant is 36px with 14px text.
- **Primary:** Action Blue fill with white text. One per decision; when a rule finds a conflict, the primary moves to the safer action.
- **Default:** Paper fill, Rule Strong border, Ink text.
- **Focus / Disabled:** a 2px Action Blue outline offset 2px on focus; disabled drops to 55% opacity with a not-allowed cursor.
- **Link button:** no border or fill, Action Blue at 600 weight, underline on hover.
- A trailing ellipsis ("Send Back to Agent…") means the button opens a dialog before anything happens.

### Status Tags
The system's signature in place of pills.
- **Style:** Paper fill, Rule Strong border, 4px radius, 13px at 600 weight, with an 8px squared marker in the status colour.
- **Variants:** Needs Decision (amber), Resolved (green), Blocked or conflict (red), informational (blue: running), idle (grey marker, secondary text: waiting, on hold, closed). Waiting is grey in the outcome bar too; blue is never a status there. An agent with cases waiting on a person reads "Needs Decision", the same name as the case status, with its count ("1 Needs Decision"). A solid variant on the dark Rail colour heads the case page.
- **Citation tags:** mono 12px on Action Blue Wash, 3px radius (the one sub-4px radius, at this size), linking a sentence to its evidence.

### Cards / Containers
- **Corner Style:** 8px for panels. Nothing inside a panel is a card: option rows and evidence items are ruled rows (a 1px Rule above each), and a verdict is a 3px inset line in its status colour, never a filled box.
- **Background:** Paper; the policy excerpt and raw output use Paper Shade.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px Rule. Panel headers are separated by a Rule line.
- **Internal Padding:** 20px by 22px; figure cells 16px by 18px.
- **Key figures:** one ruled ledger (a single bordered strip divided by Rule lines), not separate tiles; cells wrap with the last row stretching, so there is never an orphan tile or empty cell. Under the Invoice Resolver's figures, "Why N of M Closed Cases Needed a Person" lists each routing reason with its group (Policy, Risk, Evidence) and a case count, all from the API.
- **Decision band:** amber wash with an amber line, holding the waiting decision and a single Review button.

### Inputs / Fields
- **Style:** Paper fill, Rule Strong border, 6px radius; 44px tall, or 36px for search. The dialog's text area is 16px text with a 160px minimum height.
- **Focus:** the 2px Action Blue outline.
- **Segmented control:** three joined cells with Rule Strong dividers; the selected cell takes Action Blue Wash and 600 weight.

### Navigation
- **Links, not buttons:** every navigation target (rail items, breadcrumbs, case rows, Review, Next Decision, roadmap chips) is a link with a real hash URL, so it opens in a new tab; a case row also opens on a plain click anywhere in the row. A queue's tab, search and sort live in the hash query (`#/cases?tab=hold&q=alder`), so Back and a bookmark return to the same view. In a queue, the arrow keys (or J and K) move between case links.
- **Sidebar:** dark Rail in both themes. Items are 40px tall with a 6px radius; hover adds a 6% white tint, the current item takes the Rail Line fill with white 500-weight text. Agents show a bordered two-letter monogram with a squared status dot. Counts are amber badges at the 4px radius.
- **Tabs:** text tabs on a Rule line; the selected tab gets a 2px Action Blue underline and 600 weight, with its count in muted text.
- **Breadcrumb:** 14px secondary text with the current page in Ink at 500 weight.

### Step Strip
The spine of the case story. A single ruled panel divided into equal cells, one per step: a numbered dot with the time, a 600-weight title, and one line of result. Completed dots are green; the current step is washed amber. Every cell is a button; the selected one carries a 3px Action Blue underline and opens its drill-down beneath the strip, whose three cells have their own headings.

Every invoice case with more than three steps reads as chapters: Found, Investigated, Proposed, Decided (Your Decision while it waits on a person), Carried Out, each with its step count. The run-view button is always "Open Run View". A step that ran no tools has no "What Ran" cell, and the drill-down title is the strip's h2. Selecting a chapter lists its steps as small buttons in the drill-down; "Show All N Steps" brings back the full strip.

### Decision Bar and Dialog
The bar states what approving will do in one sentence, then offers the actions and who the decision is recorded as. Every action opens a native dialog first (the trailing ellipsis): what will happen, the facts it writes (action, amount, payable total, case, vendor invoice) for Approve, a labelled text area, Cancel and one primary confirm. Approving against the policy requires a reason, and the workflow refuses an approval without one. Send Back offers preset feedback buttons above the text area for phone use. The keys A, S and E open Approve, Send Back and Escalate when no field has focus; the bar lists them. The dialog enters with a 160ms fade and 8px rise, skipped under reduced motion.

- **Deadline:** a waiting case states under its heading how long is left to decide ("Decide within 5d 3h") and what happens if nobody does, from the API (the agent's configured review window).
- **Two voices, each named:** the agent's panel is "Agent’s Proposal"; anything recommended by a deterministic check says so ("Policy check: send back.", "Source check: send back."). The word "recommended" never belongs to two voices. When the policy check finds a conflict, its verdict leads, and the agent's prose follows under "Agent’s Reasoning · Not Supported by the Policy Check", set quieter (15px, secondary text, a Rule Strong line at its left).
- **One headline form:** every invoice case, waiting or decided, opens with the same sentence: "The agent proposes (or proposed) X for the $N exception on vendor invoice V from Vendor.", plus "The policy check points to Y." when it disagrees. What was decided belongs to the receipt band.
- **Rules stated once:** the routing panel ("Why This Is with You") lists the rules; the step strip only counts them and points there.
- **Disabled confirm:** a confirm that cannot be pressed says why beside it ("A reason is required to approve against the policy.").
- **Run a Sample Invoice** is a default (secondary) button; the one primary on the agent page is reserved for real work.
- **Phone "Decide" sheet:** at 720px and below the bar stays pinned but compact: one full-width Decide… button (the sentence of what approving does moves into the dialog, never cut mid-clause), which opens the dialog with the three choices; at 640px the dialog is a bottom sheet.
- **Receipt band:** once a case is decided, a band under the header states who decided, when, what was written and any reason given: green for approved within the rules or closed without a person; amber, titled "Approved Against the Policy by …", when a person overrode the policy check; neutral grey for an escalation and while the decision is being carried out. Red is kept for rule stops and conflicts. An override also marks the case header, its queue row ("Approved Against Policy") and its own Overview panel, "Where a Person Overrode the Policy Check", kept apart from the rule stops, with a link to the ERP writes in the audit trail and a Next Decision button to the oldest other case waiting.
- **Writes to the ERP:** the Routing panel lists each write with what allowed it, the approving person or the named workflow rule, and the step drill-down repeats it beside the tool call.

### Tabs
Tabs follow the WAI-ARIA pattern: one tab stop, arrow keys and Home/End move and select, and a single tab panel labelled by the selected tab (`apps/web/src/tabs.ts`). The case queue always ends with an All tab.

### Glossary
Terms in running text (confidence, three-way match, eval pass rate, budget, model tiers, approval line, policy fit, protective hold, guardrails, skills, engine history) are dotted-underlined buttons, in the casing of the text around them, that open the Glossary scrolled to and focused on their entry, highlighted with a 3px Action Blue inset line. Entries are alphabetical with a filter field. The footer on every page opens the Glossary dialog: case and vendor invoice, demo invoice, three-way match, PO, goods receipt, approval line, policy fit, skill, send back, escalate, protective hold, model tiers, run view.

### Skip Link
The first focusable element is "Skip to Main Content", shown on focus. It moves focus to the content without changing the URL hash the router uses.

### Data Marks
Comparison bars (22px, Bar Slate with the variance in amber), a threshold meter, 6px progress tracks, and a single segmented outcome bar with a legend. Marks are flat fills with 2–5px radii and always sit beside the number they show.

## Do's and Don'ts

### Do:
- **Do** lead every case with the decision and state in one sentence what approving, sending back or escalating will do.
- **Do** report status with a squared 8px marker and a text label; colour is never the only signal.
- **Do** keep one primary button per decision, and move it to the safer action when a rule finds a conflict.
- **Do** use title case for labels in titles, tabs, headings, buttons and tags.
- **Do** separate surfaces with 1px rules and tone; reserve shadows for menus, dialogs and docked drawers.
- **Do** give every theme-dependent colour a token in `docs/design/agent-portal/tokens.css`, defined for light and dark.
- **Do** keep controls at 44px (36px for compact ones, including sort headers, roadmap chips and drawer tabs) and focus visible with the 2px Action Blue outline.
- **Do** name the two identifiers one way each: "Case INV-20931" for the case reference and "vendor invoice SAL-4410" for the vendor's own number. Demo runs work their own copies, "Case INV-20931-D3".
- **Do** write a date with a time one way: "21 Nov 2026, 14:05"; a time of day alone is "14:05:09"; Live Run offsets are "00:41"; elapsed and remaining time in words ("45 sec", "6 min", "3 hr 54 min", "2 days"), never a bare "m".
- **Do** describe the budget one way: "this budget period" (the gateway's period), never "30 days".
- **Do** sort the decision queue oldest first and say so ("Age · Oldest First"); case history defaults to newest first. Rows follow the order the header names exactly, with no hidden grouping.
- **Do** show an evidence item's stance and its citation as two facts ("Supports" and "Cited"), so the count above always matches.
- **Do** use one name per status everywhere, the phone strip included: "Needs Decision" for a case waiting on a person and for an agent that has one.
- **Do** give a research brief the same anatomy as an invoice case: titled by its question, a deadline, recorded model cost (or "Not recorded"), a "Check before approving" note when every point rests on one source or sources go uncited or are marked unrelated, and each source tagged Cited, Not Cited or Marked Unrelated.
- **Do** take every clock figure (review window, reminder and escalation days) from the API, which reads the agent's config; the browser never restates one.

### Don't:
- **Don't** drift into the pill-bubble AI look: no fully rounded pill chips, gradients, glows or sparkle icons.
- **Don't** frame agents as chatbots: no chat bubbles, personas or conversation threads. Agents are shown through cases, steps and decisions.
- **Don't** use green, amber or red for anything but status, or an agent colour for status.
- **Don't** put a shadow on a panel, tile or button.
- **Don't** set amounts or body copy in mono.
- **Don't** show a figure the run did not record; show its absence.

The Live Run view follows the system: squared 4px tags and badges, title-case node labels, no glow, no mono figures, and third-person narration without a typing animation. Tool calls in its feed read as "ERP · Purchase Order, 142 ms", never the raw tool id. The workflow graph wraps rather than scrolling sideways, so the active step is always in view. Engine History has one entry point, the docked drawer, whose closed bar names no raw event type. A replay labels its two clocks apart: Real Run Time in the header, and "Replay 00:17 of 00:17 · a 1m 43s run, with waits over 10 seconds played as 2" on the scrubber. No drift is recorded.
