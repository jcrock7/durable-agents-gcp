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
- **Rail** (`rail`, `rail-line`, `rail-text`, `rail-muted`): the dark sidebar, which stays dark in both themes.

Dark theme values for every token live in `docs/design/agent-portal/tokens.css` under `.app[data-theme="dark"]`. Agent identity colours are defined in the same file as `--agent-<id>` pairs.

### Named Rules
**The Signal Rule.** Status colours appear only where a status is being reported. Never tint a heading, icon or panel in green, amber or red for emphasis.

**The Identity Rule.** Agent colours identify an agent and are never used for status.

## Typography

**Display Font:** IBM Plex Sans (with system-ui, sans-serif)
**Body Font:** IBM Plex Sans (with system-ui, sans-serif)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace)

**Character:** One humanist-engineered sans does all the work at three weights (400, 500, 600). It reads as considered and technical without feeling cold, and its tabular figures keep money and counts aligned.

### Hierarchy
- **Display** (600, 34px, 1.1, -0.02em): the headline amount on a case. KPI figures use the same style at 30px, agent header figures at 24px.
- **Headline** (600, clamp 22–28px, 1.2, -0.01em, balanced wrap): the question a case page asks, and the agent name at 26px.
- **Title** (600, 18px): the decision band's subject, dialog titles (20px), drill-down headings (16px).
- **Body** (400, 15px, 1.5): everything else. Tables are 15px; supporting text drops to 14–14.5px.
- **Body Reading** (400, 16px, 1.6, max 76ch): the agent's recommendation and other prose meant to be read in full.
- **Label** (600, 12.5px, 0.08em, uppercase): section labels, table headers, definition terms. Sidebar group labels use 11.5px.
- **Mono** (500, 12px): citation tags such as `E1`, and raw tool output in the audit trail (12.5px).

### Named Rules
**The Title Case Rule.** Labels in titles, tabs, headings, buttons and tags use title case ("Needs Decision", "Send Back to Agent"). Sentences stay in sentence case.

**The Mono Rule.** Mono is reserved for citation tags and identifiers or raw output in the audit trail. Never set amounts, headings or body copy in mono.

## Layout

A fixed dark rail (236px, collapsing to 68px) beside a fluid main column: a 56px top bar with the breadcrumb and user chip, the page, and a footer carrying the synthetic-data notice. The page uses the full available width with 28px padding and a 24px gap between sections.

Content is arranged with intrinsic grids, so it reflows without a fixed column count: KPI tiles at a 180px minimum, header facts at 130px, step strip cells at 150px, paired overview panels at 320px with equal heights. The case page uses a 1.7fr / 1fr split for the story and its supporting facts. Panels pad 20px by 22px; table cells 12px by 18px.

The decision bar is pinned to the bottom of the case page so the choice is always in reach.

Responsive behaviour:
- **At 900px and below** the rail collapses to icons and page padding drops to 18px.
- **At 720px and below** the rail becomes a top strip, tables stack into labelled rows, the option rows and step drill-down go single column, the user menu spans the width, and the decision bar unpins with full-width buttons.
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
- **Variants:** Needs Decision (amber), Resolved (green), Blocked or conflict (red), informational (blue), idle (grey marker, secondary text). A solid variant on the dark Rail colour heads the case page.
- **Citation tags:** mono 12px on Action Blue Wash, 3px radius, linking a sentence to its evidence.

### Cards / Containers
- **Corner Style:** 8px for panels; 6px for nested blocks such as evidence cards, the policy excerpt and option rows.
- **Background:** Paper; nested blocks use Paper Shade.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px Rule. Panel headers are separated by a Rule line.
- **Internal Padding:** 20px by 22px; KPI tiles 16px by 18px.
- **Decision band:** amber wash with an amber line, holding the waiting decision and a single Review button.

### Inputs / Fields
- **Style:** Paper fill, Rule Strong border, 6px radius; 44px tall, or 36px for search. The dialog's text area is 16px text with a 160px minimum height.
- **Focus:** the 2px Action Blue outline.
- **Segmented control:** three joined cells with Rule Strong dividers; the selected cell takes Action Blue Wash and 600 weight.

### Navigation
- **Sidebar:** dark Rail in both themes. Items are 40px tall with a 6px radius; hover adds a 6% white tint, the current item takes the Rail Line fill with white 500-weight text. Agents show a bordered two-letter monogram with a squared status dot. Counts are amber squared badges.
- **Tabs:** text tabs on a Rule line; the selected tab gets a 2px Action Blue underline and 600 weight, with its count in muted text.
- **Breadcrumb:** 14px secondary text with the current page in Ink at 500 weight.

### Step Strip
The spine of the case story. A single ruled panel divided into equal cells, one per step: a numbered dot with the time, a 600-weight title, and one line of result. Completed dots are green; the current step is washed amber. Every cell is a button; the selected one carries a 3px Action Blue underline and opens its drill-down beneath the strip.

### Decision Bar and Dialog
The bar states what approving will do in one sentence, then offers the actions and who the decision is recorded as. Actions that need words (Send Back, Escalate) open a native dialog: what will happen, a labelled text area, Cancel and one primary confirm. It enters with a 160ms fade and 8px rise, skipped under reduced motion.

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
- **Do** keep controls at 44px (36px for compact ones) and focus visible with the 2px Action Blue outline.

### Don't:
- **Don't** drift into the pill-bubble AI look: no fully rounded pill chips, gradients, glows or sparkle icons.
- **Don't** frame agents as chatbots: no chat bubbles, personas or conversation threads. Agents are shown through cases, steps and decisions.
- **Don't** use green, amber or red for anything but status, or an agent colour for status.
- **Don't** put a shadow on a panel, tile or button.
- **Don't** set amounts or body copy in mono.
- **Don't** show a figure the run did not record; show its absence.

Known drift: the live run view (`.live-pill`, `.live-chip`, `.live-badge`) uses fully rounded pills, which the Square Marker Rule excludes. It is recorded here as drift, not as part of the system.
