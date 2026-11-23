# Agent portal design

The UI design for the agent portal, locked in [ADR-0021](../../adr/0021-agent-portal-ui.md). For how every agent's screens share one look while speaking their own domain's language, see [Agent screen guidelines](agent-screen-guidelines.md). The mocks use sample data only. This folder holds what the build needs: the layout, the content of each region, the theme tokens ([`tokens.css`](tokens.css)) and the avatars ([`avatars/`](avatars/)).

## Layout

```
┌──────────────┬───────────────────────────────────────────────────────────────┐
│ Agent        │ Top bar: breadcrumb · search · Sample data · theme · user      │
│ sidebar      ├───────────────────────────────────────────────────────────────┤
│ (collapsible)│ Agent header: avatar, name, status, blurb │ pattern · runs ·   │
│              │ need you · eval pass rate · budget │ MCP servers · models      │
│ Mission      │ Tabs: Cases · Runs · Tools and skills · Evals · Budget · Settings│
│ Control      ├──────────────┬─────────────────────────────┬──────────────────┤
│ button       │ Case list    │ Selected case               │ Inspector        │
│              │              │ facts · proposal · evidence │ Timeline         │
│ Agents       │              │ approval rule · actions     │ Tool calls       │
│              │              │ queued message (if any)     │ Skills · Cost    │
│ Platform     │              │ Steer this case             │ Guardrails       │
└──────────────┴──────────────┴─────────────────────────────┴──────────────────┘
```

At phone width the regions stack: sidebar, then the agent header, case list, case and inspector.

## Agent sidebar

- Dark in both themes. Header: product name ("Agent Operations") and a collapse button (44px target, `aria-label` changes with state).
- **Mission Control** button: opens the overlay; shows how many cases across all agents need a person.
- One button per agent: 40px avatar, a status dot (active, waiting, needs attention, idle) and a count badge when cases need a person. Expanded rows add the short name and purpose. The current agent has `aria-current="page"`.
- **Coming soon:** an agent that is not built is dimmed, shows "Coming soon" in place of its purpose, has no badge and a grey dot. Its screen shows a "Coming soon" notice above a preview with sample data. In Mission Control its row shows "Coming soon" and dashes, and it contributes nothing to the figures, runs or events.
- Footer: platform health and the cluster auto-stop countdown.

| Agent (folder) | Short name | Purpose line | State |
|---|---|---|---|
| `invoice-exception-resolver` | Invoice Resolver | Works invoices the ERP could not match | Building |
| `cve-remediator` | Vulnerability Patcher | Patches vulnerable dependencies by PR | Coming soon |
| `audit-evidence-collector` | Audit Collector | Screens evidence for IT controls | Coming soon |
| `finops-cost-sentinel` | Cost Sentinel | Explains cloud and GPU spend | Coming soon |
| `incident-commander` | Incident Commander | Triages alerts and proposes fixes | Coming soon |
| `research-summarize` | Research Analyst | Writes cited research briefs | Built |

## Agent screen

- **Header strip:** avatar (48px), short name, status tag, one-line description; figures separated by dividers: pattern, runs in 24 hours, cases that need a person, eval pass rate, 30-day budget with a bar (turns amber at 90%). Below: the agent's MCP servers and model aliases as mono tags.
- **Case list:** id (mono), status tag, title, one line of context (waiting time, timer, guardrail). The selected case is highlighted.
- **Case panel:**
  - Title, prompt and skill versions (mono), status tag, cost so far.
  - Three key facts in a divided row. Amounts that come from a deterministic tool say so (for example "Amount (match-engine)").
  - The proposal text with citation markers `[E1]`, and an evidence table: reference, finding, source `server:tool`.
  - The approval rule as a notice: amber when a person must approve, blue for information, green when already approved. It names the rule and threshold.
  - Actions in the panel footer, primary first.
  - A queued outbound message, when the case has one, marked as sent only after approval.
  - "Steer this case": free-text feedback sent to the workflow as a signal.
- **Inspector tabs:**
  - **Timeline:** from the Temporal history. Done, waiting (amber ring), running (blue ring) and not started; retries and resumes after a worker restart appear as notes on the step.
  - **Tool calls:** every call with who made it (workflow, activity or model) and duration; a selected call shows its arguments and result; refused calls (allow-list) are shown, not hidden.
  - **Skills:** name, version and the step that loaded it.
  - **Cost:** cost per step and model alias, total for the case, and that it is billed to the agent's own LiteLLM key.
  - **Guardrails:** each rule that fired or passed on this case.

## Mission Control

A modal dialog (`role="dialog"`, `aria-modal`) covering most of the window, closed with its close button.

1. **Platform** strip: Temporal, LiteLLM gateway, Postgres, cluster auto-stop, cluster name.
2. **Key figures:** agents live, cases that need a person (with the oldest wait), waiting on others, stopped by a rule today, spend this month against live keys.
3. **Agents** table: avatar, name and purpose, status, runs, need you, evals, budget bar, Open (switches the agent screen and closes the overlay).
4. **Runs by status** table with a segmented filter: run id, agent, status, current step, durability (waiting time, timer, resumed attempt), cost.
5. **Boundary events:** guardrail blocks, fraud flags, allow-list refusals, budget alerts, approval thresholds, each with agent and case.
6. **MCP servers:** replicas (with HPA range for custom servers), kind and access, calls in the last hour.

## Visual language

- IBM Plex Sans for text, IBM Plex Mono for ids, tools, versions and money in tables. Tabular numbers.
- 4px corners, 1px borders, no shadows except the overlay. Panels have a header row with a small uppercase label.
- Status tags: squared, thin border, tinted background, from the `--ok`, `--info`, `--warn` and `--idle` tokens. Never color alone: every tag has text.
- One accent (blue) for primary actions, links and selection.
- Light and dark themes from [`tokens.css`](tokens.css); a toggle in the top bar.
- Touch targets at least 44px for primary controls; text contrast at least 4.5:1 in both themes.

## Avatars

Gummy blobs, one color per agent, each holding a prop for its job: receipt (Invoice Resolver), shield (Vulnerability Patcher), clipboard (Audit Collector), coin (Cost Sentinel), siren (Incident Commander), magnifying glass (Research Analyst). Files are named after the agent folder in [`avatars/`](avatars/). Avatars are decorative next to a visible name (`alt=""`).
