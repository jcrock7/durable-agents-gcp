---
name: Agent Operations
description: A decision-first case portal for AI agents, drawn as an auditor's working paper with a pencil mark on every figure.
colors:
  desk: "#E9EEE6"
  sheet: "#FBFCF8"
  sheet-shade: "#F2F5EF"
  row-hover: "#EEF2EA"
  rule: "#C9D4C3"
  rule-faint: "#DCE4D7"
  text: "#1D2420"
  text-2: "#4A564E"
  text-3: "#56625A"
  ink: "#161B22"
  on-ink: "#FFFFFF"
  pencil: "#B23A2B"
  selection-wash: "#E4EBE0"
  link: "#0B5CAD"
  link-hover: "#08467F"
  held-slate: "#8FA3BF"
  track: "#DCE4D7"
  decision-amber: "#E39A1B"
  on-amber: "#1B1200"
  amber-text: "#8F4C00"
  done-green: "#1E7A34"
  stop-red: "#A8281F"
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
  sheet-title:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  dialog-title:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
  section-title:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  emphasis:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body-reading:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  supporting:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  supporting-sm:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  column-head:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  mark:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  rail-label:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    letterSpacing: "0.09em"
  rail-badge:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
  mono:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 400
rounded:
  sheet: "0px"
  marker: "2px"
  tag: "4px"
  control: "6px"
  menu: "8px"
  dialog: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  section-gap: "10px"
  md: "12px"
  lg: "18px"
  sheet-gap: "22px"
  page: "28px"
  block: "30px"
  sheet-x: "32px"
  column-gap: "40px"
  margin-column: "320px"
components:
  sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text}"
    rounded: "{rounded.sheet}"
    padding: "28px 32px 32px"
  button:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  button-sm:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  decision-bar:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-text}"
    padding: "12px 28px"
  decision-bar-primary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  decision-bar-button:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  status-tag:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text}"
    typography: "{typography.supporting-sm}"
    padding: "0"
  mark:
    textColor: "{colors.pencil}"
    typography: "{typography.mark}"
  mark-legend:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text-2}"
    padding: "14px 16px"
    width: "320px"
  citation:
    textColor: "{colors.link}"
    padding: "0 1px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text}"
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
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.control}"
  dialog:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "22px 24px"
    width: "min(640px, calc(100vw - 32px))"
---

# Design System: Agent Operations

## Overview

**Creative North Star: "The Working Paper"**

Every page in the main panel is one auditor's working paper: a single ruled sheet laid on a green columnar-pad desk, headed with its title, a prepared line ("Prepared by the runs · decided by you") and a record reference, over a heavy rule. What waits on the reader comes first, then what the agents recorded, then the proof. Every figure on the sheet carries a small pencil mark saying how it is known: recorded by a run, totalled from the records it covers, checked against a rule, or absent. The reader acts from an ink decision bar that states the consequence before it offers the buttons.

The voice is quietly confident. Authority comes from ruled columns, exact numbers and marks that show the working, not from boxes, tints or weight. The sheet is off-white paper divided only by hairline rules and title-case section heads; nothing inside it is a card. Colour is scarce and each colour has one job: the rail's ink for primary buttons and the decision bar, pencil red for marks, amber for "a person is needed", blue for links and citations, and green, slate and stop red for the states they report. The dark rail is the same rail as before and stays dark in both themes.

The system rejects three looks by name. It is not the grey desk of white bordered cards, uppercase micro-labels and stacked tinted alert boxes it replaced. It is not the pill-bubble AI look: no rounded pill chips, gradients, glows or sparkle icons. And it is not a chatbot: agents are presented through cases, steps and decisions, never as chat personas or conversations.

How the look divides between what every agent shares and what each agent's domain sets (words, record fields, block order, figures) is laid out in [Agent screen guidelines](docs/design/agent-portal/agent-screen-guidelines.md); this file and that one describe the same system and are kept in step.

**The Step Record Rule.** Anything the run says about itself, including the Live Run feed's narration, is a third-person step record ("Found contract amendment 07…", "Invoice put on hold: …"), never "I" or "we", and appears whole as it arrives, with no typing animation.

**Key Characteristics:**
- One ruled sheet per page; no cards, boxes or tinted callouts inside it.
- Every figure carries a pencil mark, and every sheet pins a legend for its marks.
- The rail's ink appears in the main panel only as primary buttons and the decision bar.
- Status is a word with a small squared marker, never a chip or a filled band.
- Figures sit in ruled ledger tables with a Basis column and a double-ruled total.
- Tabular numerals everywhere, so figures align down a column.
- Light and dark themes from one token set.

## Colors

A green-tinted paper world: desk, sheet and hairline rules in close greens, near-black text, and a handful of single-job colours.

### Primary
- **Rail Ink** (`ink`): the rail's colour carried into the main panel in exactly two places, the primary button and the decision bar (which takes the rail's own background, `rail`). It also draws the selected step's underline, the selected tab's underline and the focus outline. In dark theme it inverts to the light text colour with dark button text.

### Secondary
- **Pencil** (`pencil`): the marks beside figures and nothing else. Always a small glyph, never a fill, border or background.
- **Decision Amber** (`decision-amber`): the marker for "waiting on a person": the decision queue's square, a Needs Decision tag's square, the current step's numbered dot, the rail's counts and the budget track that has run over. Text on amber uses `on-amber`; the current step's label uses `amber-text`.
- **Link Blue** (`link`, hover `link-hover`): links and source citations only. An agent's name in the margin column is a link and reads blue for that reason.

### Tertiary
- **Done Green** (`done-green`): done, resolved and fits-policy states, as a square marker or a numbered step dot.
- **Held Slate** (`held-slate`): held, settled and running states, and the neutral fill of comparison bars, so amber stays reserved for the part that waits on a person.
- **Stop Red** (`stop-red`): a rule stopped the agent, an escalation, or a conflict with policy. It appears as a filled square beside a word, or as the word itself in a verdict, so pencil and stop never look alike.

### Neutral
- **Desk** (`desk`): the ground behind the sheet; the top bar sits on it with no surface of its own.
- **Sheet** (`sheet`) and **Sheet Shade** (`sheet-shade`): the page surface, and the slightly recessed tone for raw output and selected drawer tabs. **Row Hover** (`row-hover`) is the hover tone on clickable rows and step cells.
- **Rule** (`rule`) and **Rule Faint** (`rule-faint`): section rules, the sheet's border and control outlines; and the rows inside a table or list. The heavy rule under a sheet head (2px), the rule under a table head (1px) and the total row's double rule (3px) are drawn in Text.
- **Text** (`text`, `text-2`, `text-3`): body and figures; supporting text, bases, column heads and section sub-lines; and the quietest meta.
- **Selection Wash** (`selection-wash`): the highlighted policy row, the selected tool call and text selection. It is a selection tone, not a status.
- **Track** (`track`): the empty part of budget and progress tracks.
- **Rail** (`rail`, `rail-line`, `rail-text`, `rail-muted`, `rail-ink`, `rail-control`): the dark sidebar, unchanged by the working-paper rebuild, and the decision bar, which borrows it. Status dots on the rail use `rail-ok`, `decision-amber`, `rail-idle`, `rail-off` (roadmap) and `rail-down`, lighter values chosen to read on the dark rail. No colour on the rail is written inline.

Dark theme values for every token live in `docs/design/agent-portal/tokens.css` under `.app[data-theme="dark"]`, mirroring the token blocks at the top of `apps/web/src/styles.css`.

### Named Rules
**The Ink Rule.** The rail's ink reaches into the main panel in exactly two places: primary buttons and the decision bar. Nothing else in the panel uses it as a fill.

**The One Tint Rule.** At most one tinted area per screen, and only for the thing waiting on a person. The built sheets use none: a verdict, a receipt, a notice or an error is a word with a marker between two rules.

**The Signal Rule.** Status colours appear only where a status is being reported. Never tint a heading, icon or section in green, amber or red for emphasis, and never use pencil for status.

**The Shape Rule.** A status marker never relies on colour alone. A filled square means a person is needed (amber) or a rule stopped the agent (stop red), a diamond a conflict, a tick a check that passed, and an outline square a note or a stop that did not need a person; each also carries a word or a visually hidden text label.

## Typography

**Display Font:** IBM Plex Sans (with system-ui, sans-serif)
**Body Font:** IBM Plex Sans (with system-ui, sans-serif)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace), for raw output only

**Character:** One humanist-engineered sans does all the work at three weights (400, 500, 600). Hierarchy comes from a short ramp and ruled placement rather than size jumps; tabular figures keep money and counts aligned down every ledger.

### Hierarchy
- **Sheet Title** (600, 24px, 1.25, -0.01em, balanced wrap): the page's one heading, whether an overview date line, an agent's name or the question a case asks. 22px on a phone.
- **Dialog Title** (600, 20px): the decision dialog's heading.
- **Section Title** (600, 17px, 1.3, title case): each section of the sheet, on a Rule line, with an optional 13.5px sub-line beside it in Text 2.
- **Emphasis** (600, 16px): a decision queue row's title and amount, record-fact values, and drill-down headings.
- **Body Reading** (400, 16px, 1.6, max 76ch): the agent's proposal and other prose read in full.
- **Body** (400, 15px, 1.5): everything else, ledger rows included. Ledger values are 600.
- **Supporting** (400, 14px and 13.5px): the prepared line, bases and queue sub-lines (14); section sub-lines, legend entries, tags and stop meta (13.5). The decision bar's sentence and dialog sentences are 14.5px. Do not add sizes between these.
- **Column Head** (500, 13px, sentence case, Text 2): table heads, record-fact terms and the sheet reference's sub-line.
- **Mark** (500 italic, 13px, Pencil): the four mark glyphs.
- **Rail Label** (600, 11.5px, 0.09em, uppercase) and **Rail Badge** (600, 11px): the rail's group labels, monograms and collapsed counts. Uppercase lives on the rail and nowhere else.
- **Mono** (12–13px): raw tool output, engine history and audit identifiers in the run record.

Weights are 400, 500 and 600 only.

### Named Rules
**The Title Case Rule.** Labels in titles, section heads, tabs, buttons and tags use title case ("Decisions Waiting on You", "Send Back to Agent"). Sentences, column heads and sub-lines stay in sentence case.

**The No Micro-Label Rule.** Small uppercase tracked labels belong to the rail only. In the main panel a section is named by a 17px title-case head and a column by a 13px sentence-case head.

**The Mono Rule.** Mono is reserved for raw output and identifiers in the run record. Never set amounts, citations, headings or body copy in mono.

## Layout

A fixed dark rail (236px, collapsing to 68px) beside a fluid main column: a transparent top bar on the desk with the breadcrumb and user chip, the sheet, and a footer carrying the synthetic-data notice. The page pads the sheet 12px at the top and 28px at the sides and bottom.

The sheet pads 28px by 32px (32px at the foot) with a 22px gap between its parts. Under the sheet head it splits into a main column and a 320px margin column with a 40px gutter; blocks stack 30px apart in each. The margin holds the pinned mark legend at its top, then routing, agents, run figures and settings. Which blocks sit in which column, and in what order, is each agent's page recipe (`apps/api/src/registry.ts`), rendered by the shared sheet columns; the grid itself never changes.

The decision bar is pinned to the bottom of the case page so the choice is always in reach. At every desktop width the full sentence of what approving does has its own row (at most 72ch), consequence first, never cut; a conflict adds a short red verdict before it ("Policy check: Send Back"). The buttons and "Recorded as" share the row below.

The Live Run view opens beside the collapsed rail (68px), so navigation stays where it is on every page; on a phone it takes the full screen with a Back to Case link.

Responsive behaviour:
- **At 1100px and below** the margin column moves under the main column and lays its blocks side by side at a 280px minimum; tables drop their optional columns between 721px and 1100px.
- **At 900px and below** the rail collapses to icons, the page pads 8px by 18px and the sheet 22px.
- **When the case list's own panel is under 1000px** (a container query, so the sidebar is counted) the case list reads as cards, as on a phone (case, agent and type, status, what happens next, then figures), with a Sort menu in place of the column headers, so nothing scrolls sideways on a laptop or projector. Evidence drops to one column whenever its column is under about 640px.
- **At 720px and below** the rail becomes a top strip with a short label under each icon, the sheet runs full width with no side borders (20px by 16px padding), the sheet reference drops under the title, the queue's Review moves under its row, ledgers drop the Basis column, the breadcrumb shows only the last two crumbs, tables stack into labelled rows, and the decision bar becomes one full-width Decide… button.
- **At 640px and below** the decision dialog becomes a bottom sheet.

## Elevation & Depth

Flat. The sheet lies on the desk with a 1px Rule border and no shadow; inside it, depth is never used. Structure comes from rules of three weights: a 2px Text rule under the sheet head (and above a receipt), 1px Rule under section titles and around strips, and 1px Rule Faint between rows. Hover is a tone change, never a lift.

### Shadow Vocabulary
- **Floating menu** (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18)`): the user menu.
- **Dialog** (`box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3)` over a `rgba(10, 16, 24, 0.55)` backdrop): the decision dialog.
- **Docked drawer** (`box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.18)`): the Live Run view's event drawer.

### Named Rules
**The Floats-Only Rule.** A shadow means the element is floating above the page and can be dismissed. The sheet, its sections, buttons and the decision bar never carry one.

## Shapes

Square paper, softly squared controls. The sheet, its sections, strips and rows have square corners and 1px rules. Radius appears only on things you handle or that float: 2px for status markers, tracks and comparison bars; 4px for keyboard keys, rail counts and monograms; 6px for buttons, inputs and nav items; 8px for the user menu; 10px for the dialog. The only circles are the numbered step dots. The only framed element inside a sheet is the mark legend, an unfilled box ruled in Text.

**The Square Marker Rule.** Status is a small squared marker (8–9px, 2px radius) beside a word. There is no tag box around it, and it is never a fully rounded pill.

## Components

### Buttons
Plain and decisive, sized for a pointer or a finger.
- **Shape:** softly squared (6px), 44px tall, 18px side padding, 600 weight at 15px. A small variant is 36px with 14px text.
- **Primary:** Rail Ink fill with white text; hover brightens it. One per decision; when a rule finds a conflict, the primary moves to the safer action. In a decision queue, each waiting row's Review is the row's primary (at least 96px wide).
- **Default:** transparent on the sheet, Rule border, Text label.
- **Focus / Disabled:** a 2px Ink outline offset 2px on focus; disabled drops to 55% opacity with a not-allowed cursor.
- **Link button:** no border or fill, Link Blue at 600 weight, underline on hover.
- A trailing ellipsis ("Send Back to Agent…") means the button opens a dialog before anything happens.

### Status Tags
A word with a squared marker, nothing more.
- **Style:** no fill and no border; 13.5px at 600 weight, an 8px squared marker in the status colour before the word.
- **Variants:** Needs Decision (amber), Resolved (green), escalated or conflict (stop red), idle (grey marker, Text 2: waiting, on hold, cancelled, closed). Running is Held Slate, as in the outcome rows; in the outcome rows Waiting and Cancelled are outline squares. An agent with cases waiting on a person reads "Needs Decision", the same name as the case status, with its count ("2 Needs Decision"). On a case page the tag sits under the record reference at the sheet head's right.
- **Citations:** a linked reference in the body face, 600 weight at 0.85em in Link Blue, raised 1px, with no chip behind it ("E1", "S2").

### Sheet and Sheet Head
The page itself. One sheet per page on the desk (Sheet fill, 1px Rule border, square corners). The head holds the sheet title, the prepared line in 14px Text 2 (a case's deadline line takes its place, with the time left in 600 Text), and at the right the record reference in 14px 600 with a 13px sub-line or the status tag, all over a 2px Text rule. Record facts follow as one ruled row of labelled values (13px column-head terms, 16px 600 values), closed by a Rule.

### Marks and Mark Legend
The system's signature. Every figure on a sheet carries one mark, drawn beside it at 13px in Pencil, italic 500: ✓ recorded by a run, ⊕ totalled from the records it covers, ◇ checked against a rule, — not recorded and shown as absent. Each glyph is hidden from assistive technology and carries a visually hidden word in its place. The glyphs and their core meaning are shared by every agent; an agent supplies only the name of the rule a ◇ checks against (approval line, budget, citation rule).

The Mark Legend is pinned at the top of the margin column: an unfilled box ruled 1px in Text, 14px by 16px padding, titled "Mark Legend" at 14px 600, one 13.5px Text 2 row per mark with the glyph in a 22px column. A sheet lists only the marks it uses.

**The Mark Rule.** Marks are glyphs at 13px, never fills, never badges, and never the only carrier of meaning. Stop red appears only as a filled square beside a word, so pencil and stop never look alike.

### Ledger Figures
Figures are a ruled table, never tiles: Figure, Basis and Value columns under 13px sentence-case heads on a 1px Text rule; rows 9px tall-padded on Rule Faint lines; the value right-aligned at 600 with its mark; the basis in 14px Text 2 saying where the figure comes from. A total row is ruled 1px Text above and 3px double Text below. Outcome counts use the same rows with a squared marker per status. A block of one agent's figures on a shared screen is titled with that agent's name ("Invoice Resolver · Last 7 Cases").

### Decision Queue
What waits on the reader. Ruled rows on a Rule line: a 9px amber square, the title at 16px 600 with the case reference, a 14px Text 2 line of who, where, how long and why, the amount at 16px 600 with its mark, and Review in ink. Oldest first. When nothing waits, a single Text 2 line says so.

### Rule Stops
Where a rule stopped an agent or a person overrode one: one ruled line each, a stop-red filled square where a rule stopped the agent and an outline square otherwise, the rule's name in 600 then the run's own words, and a 13.5px Text 2 line with the agent, the linked cases and how long ago.

### Inputs / Fields
- **Style:** Sheet fill, Rule border, 6px radius; 44px tall, or 36px for search and sort. The dialog's text area is 16px text with a 160px minimum height.
- **Focus:** the 2px Ink outline.
- **Segmented control:** three joined cells with Rule dividers; the selected cell takes Selection Wash and 600 weight.

### Navigation
- **Links, not buttons:** every navigation target (rail items, breadcrumbs, case rows, Review, Next Decision, roadmap entries) is a link with a real hash URL, so it opens in a new tab; a case row also opens on a plain click anywhere in the row. A queue's tab, search and sort live in the hash query (`#/cases?tab=hold&q=alder`), so Back and a bookmark return to the same view. In a queue, the arrow keys (or J and K) move between case links.
- **Sidebar:** dark Rail in both themes, unchanged. Items are 40px tall with a 6px radius; hover adds a 6% white tint, the current item takes the Rail Line fill with white 500-weight text. Agents show a bordered two-letter monogram with a squared status dot. Counts are amber badges at the 4px radius.
- **Tabs:** text tabs on a Rule Faint line; the selected tab gets a 2px Ink underline and 600 weight, with its count in muted text. Tabs follow the WAI-ARIA pattern (one tab stop, arrow keys and Home/End, a single labelled panel; `apps/web/src/tabs.ts`), and the case queue always ends with an All tab.
- **Breadcrumb:** 14px Text 2 on the desk, with the current page in Text at 500 weight.
- **Roadmap:** a ruled list of links in the margin column.

### Step Strip
The spine of the case story. A ruled strip (Rule above and below, Rule Faint between cells, no box) divided into equal cells, one per step: a numbered dot with the time, a 600-weight title, and one line of result. Completed dots are green; the current step's dot is amber with its label in Amber Text and no tint behind it. Every cell is a button; the selected one carries a 3px Ink underline and opens its drill-down beneath the strip, whose three cells have their own headings.

Every invoice case with more than three steps reads as chapters: Found, Investigated, Proposed, Decided (Your Decision while it waits on a person), Carried Out, each with its step count. The run-view button is always "Open Run View". A step that ran no tools has no "What Ran" cell, and the drill-down title is the strip's h2. Selecting a chapter lists its steps as small buttons in the drill-down; "Show All N Steps" brings back the full strip.

### Decision Bar and Dialog
The bar is the rail's ink in both themes (Rail fill, Rail Line above), and it leads with the consequence: one sentence of what approving will do ("If you approve: …", lead words in Rail Ink, the rest in Rail Text), then the actions, then who the decision is recorded as in Rail Muted. Its primary button is the sheet colour with ink text; the others are outlined in Rail Control. Every action opens a native dialog first (the trailing ellipsis): what will happen, the facts it writes for Approve, a labelled text area, Cancel and one primary confirm. Approving against the policy requires a reason, and the workflow refuses an approval without one. Send Back offers preset feedback buttons above the text area for phone use. The keys A, S and E open Approve, Send Back and Escalate when no field has focus; the bar lists them. The dialog enters with a 160ms fade and 8px rise, skipped under reduced motion.

- **Deadline:** a waiting case states under its heading how long is left to decide ("Decide within 5d 3h") and what happens if nobody does, from the API (the agent's configured review window).
- **Two voices, each named:** the agent's proposal is labelled from the agent's vocabulary ("Proposed Resolution", "Draft Brief"); anything recommended by a deterministic check says so ("Policy check: send back."). The word "recommended" never belongs to two voices. When the policy check finds a conflict, its verdict leads, and the agent's prose follows quieter (15px, Text 2).
- **One headline form:** every invoice case, waiting or decided, opens with the same sentence: "The agent proposes (or proposed) X for the $N exception on vendor invoice V from Vendor.", plus "The policy check points to Y." when it disagrees. What was decided belongs to the receipt.
- **Verdicts:** a verdict is stated once, as a word with its squared marker on a ruled line, never a tinted box. An option that fits or conflicts says so in its last column with a green or stop-red marker.
- **Rules stated once:** the routing section ("Why This Is with You") lists the rules; the step strip only counts them and points there.
- **Disabled confirm:** a confirm that cannot be pressed says why beside it ("A reason is required to approve against the policy.").
- **Run a Sample Invoice** is a default button; the one primary on the agent page is reserved for real work.
- **Phone "Decide" sheet:** at 720px and below the bar stays pinned but compact: one full-width Decide… button (the sentence of what approving does moves into the dialog, never cut mid-clause), which opens the dialog with the three choices; at 640px the dialog is a bottom sheet.
- **Receipt:** once a case is decided, a receipt under the sheet head, ruled 2px Text above and Rule below with no tint, states who decided, when, what was written and any reason given, with the outcome as a status word. A person overriding the policy check is named in words, "Approved Against the Policy by …", on the receipt, its queue row and the Overview's rule stops, with a link to the writes in the run record and a Next Decision button to the oldest other case waiting.
- **Writes to the ERP:** the routing section lists each write with what allowed it, the approving person or the named workflow rule, and the step drill-down repeats it beside the tool call.

### Glossary
Terms in running text (confidence, three-way match, eval pass rate, budget, model tiers, approval line, policy fit, protective hold, guardrails, skills, engine history) are dotted-underlined buttons, in the casing of the text around them, that open the Glossary scrolled to and focused on their entry, highlighted in Selection Wash with a 3px Ink line at its left. Entries are alphabetical with a filter field. The footer on every page opens the Glossary dialog.

### Skip Link
The first focusable element is "Skip to Main Content", shown on focus in ink. It moves focus to the content without changing the URL hash the router uses.

### Data Marks
Budget and progress tracks (5–6px, Track with an Ink fill, amber when over), comparison bars (22px, Held Slate with the variance in amber) and a threshold meter. Marks are flat fills with a 2px radius and always sit beside the number they show, which carries its own pencil mark.

## Agent Screens

Every agent's screens share this system's look and components, and speak their own domain's language. The full rules, the vocabulary table and the page recipes are in [Agent screen guidelines](docs/design/agent-portal/agent-screen-guidelines.md).

**The Neutral Portal Rule.** Screens that list more than one agent's work (the rail, Overview, All Cases, Needs Decision) use neutral words only: case, decision, agent, run, rule, source, rule stop.

**The Domain Voice Rule.** An agent's own screens (its agent page, case page and Live Run view) take their labels from that agent's vocabulary. The invoice terms in this file, such as evidence, policy fit and "Case INV-20931", are the Invoice Resolver's vocabulary, not portal-wide words.

**The No Hard-Coded Domain Rule.** A shared component holds no domain word; it reads every label from the agent's vocabulary in the agent registry, with the neutral word as the fallback.

An agent may choose which shared components appear on its screens and in what order. It may not add colours, surfaces, fonts, cards, tinted callouts or a second primary action.

The working-paper look described in this file is built: shared parts live in `apps/web/src/sheet.tsx`, `CaseParts.tsx` and `vocab.ts`, each agent's domain layer in `apps/web/src/domain/<agent>.tsx`, and its words and page recipe in `apps/api/src/registry.ts`.

## Do's and Don'ts

### Do:
- **Do** lay each page out as one ruled sheet: head over a 2px Text rule, a main column and a 320px margin column, sections under 17px title-case heads.
- **Do** put a pencil mark beside every figure and pin the mark legend at the top of the margin column.
- **Do** draw figures as a ruled ledger with a Basis column, and double-rule a total.
- **Do** lead every case with the decision and state in one sentence what approving, sending back or escalating will do, consequence first.
- **Do** report status with a squared 8px marker and a word; colour is never the only signal.
- **Do** keep one primary button per decision, and move it to the safer action when a rule finds a conflict.
- **Do** use title case for labels in titles, section heads, tabs, buttons and tags.
- **Do** separate everything inside the sheet with 1px rules; reserve shadows for menus, dialogs and docked drawers.
- **Do** give every theme-dependent colour a token in `docs/design/agent-portal/tokens.css`, defined for light and dark.
- **Do** keep controls at 44px (36px for compact ones, including sort, search and drawer tabs) and focus visible with the 2px Ink outline.
- **Do** name the two identifiers one way each: "Case INV-20931" for the case reference and "vendor invoice SAL-4410" for the vendor's own number. Demo runs work their own copies, "Case INV-20931-D3".
- **Do** write a date with a time one way: "21 Nov 2026, 14:05"; a time of day alone is "14:05:09"; Live Run offsets are "00:41"; elapsed and remaining time in words ("45 sec", "6 min", "3 hr 54 min", "2 days"), never a bare "m".
- **Do** describe the budget one way: "this budget period" (the gateway's period), never "30 days".
- **Do** sort the decision queue oldest first and say so ("2, oldest first"); case history defaults to newest first. Rows follow the order the header names exactly, with no hidden grouping.
- **Do** show a source's stance and its citation as two facts ("Supports" and "Cited"), so the count above always matches.
- **Do** use one name per status everywhere, the phone strip included: "Needs Decision" for a case waiting on a person and for an agent that has one.
- **Do** give a research brief the same anatomy as an invoice case: titled by its question, a deadline, recorded model cost (or "Not recorded"), a "Check before approving" note when every point rests on one source or sources go uncited or are marked unrelated, and each source tagged Cited, Not Cited or Marked Unrelated.
- **Do** take every clock figure (review window, reminder and escalation days) from the API, which reads the agent's config; the browser never restates one.

### Don't:
- **Don't** bring back the grey desk of white bordered cards, figure tiles, uppercase micro-labels or stacked tinted alert boxes.
- **Don't** use the rail's ink as a fill anywhere but primary buttons and the decision bar.
- **Don't** use pencil for anything but marks, or draw a mark as a fill or badge.
- **Don't** drift into the pill-bubble AI look: no fully rounded pill chips, gradients, glows or sparkle icons.
- **Don't** frame agents as chatbots: no chat bubbles, personas or conversation threads. Agents are shown through cases, steps and decisions.
- **Don't** use green, amber or red for anything but status, or blue for anything but links and citations.
- **Don't** put a shadow on the sheet, a section, a button or the decision bar.
- **Don't** set amounts, citations or body copy in mono.
- **Don't** show a figure the run did not record; show its absence with the — mark.

The Live Run view follows the system: squared 4px tags and badges, title-case node labels, no glow, no mono figures, and third-person narration without a typing animation. Tool calls in its feed read as "ERP · Purchase Order, 142 ms", never the raw tool id. The workflow graph wraps rather than scrolling sideways, so the active step is always in view. Engine History has one entry point, the docked drawer, whose closed bar names no raw event type. A replay labels its two clocks apart: Real Run Time in the header, and "Replay 00:17 of 00:17 · a 1m 43s run, with waits over 10 seconds played as 2" on the scrubber.
