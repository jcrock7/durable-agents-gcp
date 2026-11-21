# Live Run view: design

Date: 2026-11-20 · Status: draft for approval · Mockups: `.superpowers/brainstorm/1876-1795224367/content/live-run-v3-drawer.html` (final), `live-run-v2.html`

## Intent

A screen in the agent portal for watching one invoice-exception case execute, live, and replaying finished ones. The audience is people evaluating this project as a demo (stakeholders, hiring managers), not the AP reviewer. It must make two things legible at once:

1. **The agent's logic**: what it is doing at each step and why, in plain words.
2. **The durable machinery**: Temporal retries, worker failover, replay, waits. This is the point of the project.

Success: a presenter can start a sample invoice, open this screen, narrate over it, press "Kill worker" mid-run, and the audience sees the case pick up on a new pod with nothing lost.

### Goals
- A live view of a running case: a workflow graph, a plain-language agent feed and an engine (Temporal history) drawer.
- Tool calls appear while a step is still running, not only when it finishes.
- Retries and failover show as badges on graph nodes, and in the drawer with the raw events.
- Replay for finished cases from the same screen.
- A one-click demo start: run a sample invoice and land in the live view.
- Works on k3d and GKE (behind IAP) with no new infrastructure.

### Non-goals
- Token-by-token LLM streaming. The typing effect is an animation of an already-complete sentence.
- Changing the existing case page, decision dialog or review flow, beyond adding entry points.
- The `research-summarize` agent. The endpoint is generic, but the graph and narration ship for `invoice-exception-resolver` only.
- OpenTelemetry or an event store (ADR-0008 stays deferred).

### Anti-goals
- The view showing things that didn't happen. Every row must come from Temporal history, the `caseState` query or pending-activity state. No front-end-invented events.
- A demo control that can harm anything beyond the worker pod, or that is reachable when demo mode is off.

## Approaches considered

| | Approach | Trade-off | |
|---|---|---|---|
| **A** | One `/live` endpoint merging query, history and describe, polled every 1s | Up to 1s latency. No new infrastructure, and works through IAP and the Gateway unchanged | **Chosen** |
| B | Same merge pushed over SSE | Slightly snappier, but a long-lived connection through the GKE load balancer and IAP needs backend-timeout tuning and reconnect logic: demo risk for invisible gain | Rejected. Can be swapped in later behind the same endpoint |
| C | Worker publishes events (Redis or PG NOTIFY), streamed over SSE | The only route to real token streaming, but a second source of truth beside Temporal undercuts the story, and it's the most work | Rejected |

The user picked A.

## Decided with the user

- **Layout** (mockup v3): a header bar (case, LIVE badge, elapsed, LLM cost, tool calls, ⚙ Engine button, ⚡ Kill worker), then the **workflow graph** (nodes with time, model and cost; the current node pulses; the review gate is dashed; the not-taken hold-for-GR branch is greyed), then the **agent feed** (agent voice only: time, step tag, a sentence, a "how" line, collapsible evidence; click a node to filter), then the **engine drawer** (collapsed one-line strip by default; opens with Grouped / Raw / JSON tabs and an "Open in Temporal UI ↗" link).
- **Engine events** live on graph-node badges (`↻ n retry`, `⚡ failover`) and in the drawer, **not** in the agent feed. Clicking a badge opens the drawer scrolled to and highlighting those rows.
- **Access**: a full-screen route `#/agent/<agentId>/case/<workflowId>/live`, with no nav entry. Entry points:
  1. A `◉ Watch live` button on the right of the `StepStrip` in `CaseView`, shown when the case is running. Clicking the strip also opens it.
  2. A pulsing `● Live` marker on running rows in `CaseTable`, linking straight to the view.
  3. "Run a sample invoice" on the invoice agent's page, which navigates into the new case's live view. It calls `POST /api/demo/sample-case` (decided by the user, behind `DEMO_CONTROLS`). That endpoint clones one of a small set of fixture price-variance exceptions into the synthetic ERP under a fresh invoice id (`INV-<next>`), reusing the template's vendor, PO, receipts and document (the docs store is baked into the docs MCP image), then starts a single `resolveException` case with workflow id `inv-<n>`, and returns `{ workflowId }`. Fixtures live beside the existing ERP seed. ERP writes use a dedicated demo DB role, not the agent's roles.
  - `← Back to case` and Esc return to `CaseView`.
- **Replay**: finished cases show `▶ Replay run` in the same places. The screen loads the full run once and plays it back by timestamp. Default speed is 4×, with 1×, 4× and 16× controls, pause, and a scrubber. Long waits (the review gate, GR holds) are compressed to a 2s "⏸ waited 3h 12m for review" beat.
- **Transport**: approach A.

## Design

### Data: `GET /api/cases/:workflowId/live?after=<eventId>`
Returns:
```ts
{
  status: "running" | "completed" | "failed" | "terminated" | ...,
  runId, startTime, closeTime?, workerIdentity?,         // from describe
  state: CaseState,                                     // caseState query (has timeline, toolCalls, usage, narration)
  events: EngineEvent[],                                // history events with eventId > after, condensed
  pending: PendingActivity[],                           // from describe: activityType, attempt, lastFailure, lastHeartbeatDetails, lastWorkerIdentity, scheduledTime
  cursor: number                                        // last eventId included
}
```
- `EngineEvent { id, at, type, attrs: Record<string,string|number>, step? }`. `step` maps an activity event to a graph node by activity type. Only the attributes the drawer shows are kept; the JSON tab gets the raw event for that id via `?raw=<id>`.
- `pending` is how live retries and failover are seen: Temporal doesn't write per-attempt history events.
- New `sources.ts` methods: `describe(workflowId)` and `history(workflowId, afterEventId)`, both with the existing 5s `withTimeout`.
- Replay calls the same endpoint with `after=0` once. For closed workflows the `caseState` query still works (the worker replays the workflow). If the query fails, the endpoint returns `state: null` and the UI reconstructs the graph from history only.
- Poll interval 1s while running. The existing 3s cache for running cases in `app.ts:136-151` is bypassed for this route.

### Worker changes (`invoice-exception-resolver`)
- **Heartbeat details**: extend `withHeartbeat` (packages/agent-kit/src/heartbeat.ts) so activities can call `progress(detail)`. Heartbeats carry `{ toolCalls: ToolCallRecord[] so far, note?: string }`. `gatherEvidence` reports after each MCP tool call; the other model activities report on start. The feed shows pending tool calls from `pending[].lastHeartbeatDetails` until the activity completes and they appear in `state.toolCalls`. Dedupe by `ToolCallRecord.ref`.
- **Resume without repeating tool calls (scoped to `gatherEvidence`, decided by the user)**: heartbeat details for `gatherEvidence` also carry each completed tool call's result, truncated to the same `EXCERPT_CHARS` used for evidence excerpts. On retry, the activity reads `activityInfo().heartbeatDetails` and gives the toolbox a replay cache keyed by tool and arguments. The model loop restarts, but any tool call it repeats is answered from the cache, not the server (recorded as `replayed: true`). This is simpler and more robust than rebuilding the message history. (Planning call.) If the details exceed a safe size (cap them at 256 KB, well under Temporal's payload limit), stop adding results and let the remaining calls re-run. Other activities (`readInvoice` and `draftMessage`, which make MCP calls before their model call) re-run their calls on retry, and their narration says so. This is a real behaviour change and needs tests: resume after a simulated kill makes no duplicate calls, and the final output matches an uninterrupted run.
- **Narration**: add `narration?: string` to `TimelineEntry`.
  - LLM steps (`readInvoice`, `gatherEvidence`, `proposeResolution`, `draftMessage`): add a `narration` field (1–2 sentences, first person, plain language, no figures it didn't see) to each step's structured output schema and prompt.
  - Rule steps (`runMatch`, `computeAdjustment`, `route`, gate, post, confirm): templated sentences in the workflow `step()` calls.
  - Narration only changes query state, not commands, so no `patched()` guard is needed. Replays of runs from before this change show the timeline's existing `detail` strings with a "recorded before narration" note. No generated text. (My call.)

### Web
- New `LiveRun.tsx` (route above) with subcomponents `RunGraph`, `AgentFeed`, `EngineDrawer` and `ReplayControls`.
- Graph topology is a static definition per agent (`liveGraphs.ts`): node id, label, which activity types and timeline names map to it, plus the branch. Node state is derived from timeline and events.
- A `useLive(workflowId)` hook polls with a cursor and appends events. Replay uses the same reducer, fed from a timed queue.
- Styles extend `styles.css` with the existing tokens. Dark and light both work; the mockups are dark.
- Typing effect: the newest narration line animates in over about 600ms, and respects `prefers-reduced-motion`.

### Kill worker (demo control)
- `POST /api/demo/kill-worker` **hard-kills** (`gracePeriodSeconds: 0`) a worker pod (label `app.kubernetes.io/name: worker`). A graceful delete would let the activity finish inside the 20s `shutdownGraceTime` and show no failover; the point is to simulate a crash. (My call.) It picks the pod whose name matches the running activity's `lastWorkerIdentity` where possible.
- Enabled only when the API env has `DEMO_CONTROLS=true`, set in the local overlay and in the GKE overlay (the user's demo cluster). When it's off, the button is hidden and the route returns 404.
- RBAC: a separate `Role` `demo-worker-killer` with `pods: get, list, delete`, bound to the api ServiceAccount only in overlays that enable demo controls. The existing `portal-reader` Role stays read-only.
- **The worker runs 2 replicas in both demo overlays (decided by the user).** The kill fails over to the already-running pod, so the `caseState` query keeps answering and the view stays live. The base keeps `replicas: 1`, and the overlays patch it. Kill targets the pod named in `lastWorkerIdentity`. Expected gap: during model activities, the 20s heartbeat timeout plus pod start. During tool and rule activities (`TOOL_CALL_OPTIONS`, no heartbeat timeout), up to the 30s `startToCloseTimeout`. The button is therefore enabled only while a model activity is pending. The UI shows an "Engine: waiting for a worker…" state on the node in the meantime, so the pause reads as intentional.
- Identity is shown, not checked: under IAP any portal user can press it. Acceptable for a demo cluster.

### Deploy
- Build, push and apply through the existing scripts: `scripts/local/*` for k3d, then `scripts/gke/*`. No new services, and only the RBAC and env additions above in the overlays.

## Left to the builder
- Exact drawer attribute selection per event type, and grouping rules.
- Graph rendering technique (CSS grid or flex as in the mockup; no graph library needed).
- Narration prompt wording, within the constraints above.
- How the UI tells "failover" apart from "retry": a heartbeat-timeout `lastFailure`, or a change of identity between attempts, means failover.
- Test split: unit tests for the endpoint merge, history condensing and the heartbeat resume. A component test for the replay reducer.
