# Live Run View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen Live Run view in the agent portal that shows an invoice-exception case executing (workflow graph, plain-language agent feed, Temporal engine drawer), replays finished cases, and has demo controls to start a sample case and hard-kill a worker.

**Architecture:** The worker heartbeats tool-call progress and adds a narration sentence to each timeline step. The API exposes a single `GET /api/cases/:id/live` that merges the `caseState` query, condensed Temporal history and pending-activity state, and the web view polls it every 1s. Replay fetches it once and plays it back on a client-side clock. Demo controls (`/api/demo/*`) exist only when `DEMO_CONTROLS=true`, which a kustomize component enables in both overlays along with 2 worker replicas, pod-delete RBAC and an ERP demo DB role.

**Tech Stack:** TypeScript (Node 24, `tsc -b`), Temporal TS SDK 1.25, Vercel AI SDK `generateText`, Fastify 5, zod 4, React 19 + Vite, vitest 5, kustomize, CloudNativePG, `pg` (new API dependency).

**Spec:** `docs/superpowers/specs/2026-11-20-live-run-view-design.md` (final mockup: `.superpowers/brainstorm/1876-1795224367/content/live-run-v3-drawer.html`)

## Global Constraints

- Every row the view shows comes from Temporal history, the `caseState` query or pending-activity state. Nothing invented on the front end. Old runs show their timeline `detail` text with the note "recorded before narration".
- Demo routes return **404** and the buttons are hidden unless the API env has `DEMO_CONTROLS=true`.
- Kill worker uses `gracePeriodSeconds: 0`, targets label `app.kubernetes.io/name=worker`, and is enabled only while a **model** activity (`readInvoice`, `gatherEvidence`, `proposeResolution`, `draftMessage`) is pending.
- No-repeat resume applies to `gatherEvidence` model-driven tool calls only. Heartbeat details are capped at **256 KB**. Results are truncated to `EXCERPT_CHARS` (1,500).
- Poll interval is **1s** while running. The `/live` route bypasses the 3s running-case cache.
- Replay: default **4×**, with speeds 1×/4×/16×, pause and scrub. Waits longer than 10s are compressed to a **2s** beat labelled "⏸ waited <duration> for <what>".
- Route: `#/agent/<agentId>/case/<workflowId>/live`. Esc and "← Back to case" return to `#/agent/<agentId>/case/<workflowId>`.
- Styles use only the tokens in `apps/web/src/styles.css` (ADR-0021). Light and dark both work. Typing animation is about 600ms and is disabled under `prefers-reduced-motion`.
- Worker base stays at `replicas: 1`. The demo component patches it to 2.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Query fails mid-failover or for an old closed run:** `/live` must still return 200 with `state: null` plus history and pending, and the view must draw the graph from events alone. Tested in Task 4.
2. **A workflow id that isn't an invoice case** (`exception-queue-…`, `research-…`, junk): `/live` returns 400 for ids failing `ID` or with no built agent. The view shows "Live view isn't available for this agent" for non-invoice agents. Tested in Tasks 4 and 8.
3. **Kill pressed twice, or with no model activity pending:** the second call returns 409 `{ error: "no model activity running" }`, and no pod is deleted. Tested in Task 5.
4. **Sample case started twice quickly:** each call gets a distinct `INV-<n>` and workflow id. A unique-violation is retried once with the next id. Tested in Task 5.
5. **Heartbeat details from a different code version or malformed:** resume ignores details failing the zod schema and runs fresh. Tested in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/agent-kit/src/heartbeat.ts` | `withHeartbeat` gains a `progress()` callback carrying details |
| `packages/agent-kit/src/mcp/toolbox.ts`, `mcp/types.ts` | Call ids, `replayed` flag, a replay cache of earlier results |
| `agents/general/invoice-exception-resolver/src/progress.ts` (new) | Heartbeat-details schema, capping, resume parsing |
| `…/src/activities.ts`, `schemas.ts`, `prompts/index.ts`, `types.ts`, `workflows/resolve.workflow.ts` | Resume in `gatherEvidence`, narration fields and templates |
| `apps/api/src/live.ts` (new) | History condensing, pending mapping, `/live` response assembly |
| `apps/api/src/demo.ts` (new) | `/api/demo/*` routes, the `ErpDemoSource` (pg) |
| `apps/api/src/sources.ts`, `app.ts`, `main.ts` | `describe`/`history`, worker pod list/delete, route wiring, `/api/me` gains `demoControls` |
| `platform/k8s/components/demo-controls/` (new) | Replicas, env, RBAC, network policy for the demo |
| `platform/services/postgres/cluster.yaml`, `…/data/sql.ts`, `scripts/lib/k8s.sh` | The `erp_demo` role, grants and secret |
| `apps/web/src/live/` (new) | `graphs.ts`, `reduce.ts`, `useLive.ts`, `LiveRun.tsx`, `RunGraph.tsx`, `AgentFeed.tsx`, `EngineDrawer.tsx`, `ReplayControls.tsx` |
| `apps/web/src/App.tsx`, `StepStrip.tsx`, `CaseView.tsx`, `CaseTable.tsx`, `AgentView.tsx`, `api.ts`, `styles.css` | Route and entry points |

---

### Task 1: agent-kit — heartbeat progress and a tool replay cache

**Files:**
- Modify: `packages/agent-kit/src/heartbeat.ts`, `packages/agent-kit/src/mcp/toolbox.ts`, `packages/agent-kit/src/mcp/types.ts`, `packages/agent-kit/src/index.ts`
- Test: `packages/agent-kit/test/mcp.test.ts`, `packages/agent-kit/test/heartbeat.test.ts` (new)

**Interfaces:**
- Produces:
  - `withHeartbeat<T>(call: (abortSignal: AbortSignal, progress: (details: unknown) => void) => Promise<T>, intervalMs = 5_000): Promise<T>`. `progress(d)` stores `d`. Every heartbeat (the interval tick plus one immediately on each `progress` call) sends the latest `d`.
  - `ToolCallRecord` gains `id: string` (AI SDK `toolCallId` for model calls, `randomUUID()` otherwise) and `replayed?: true`.
  - `McpToolboxOptions.replay?: Map<string, string>`, keyed by `replayKey(ref, args)` and holding the result text. In `modelTools().execute`, a key hit returns the cached text without calling the server and records `{ outcome: "ok", replayed: true, durationMs: 0 }`. It does not fire `onResult`.
  - `export function replayKey(ref: string, args: Record<string, unknown>): string` returns `ref + "|" + JSON.stringify(args with keys sorted recursively)`.

- [ ] **Step 1: Write failing tests**
  - `heartbeat.test.ts` `"sends the latest progress details on each heartbeat"`: run inside `MockActivityEnvironment` (`@temporalio/testing`). Listen for `heartbeat` events, call `progress({n:1})` then `progress({n:2})`, and expect the heartbeats received to include `{n:1}` and `{n:2}`, with the last one `{n:2}`.
  - `mcp.test.ts` `"replays a cached result without calling the server"`: an in-memory connection with a spy `callTool`, `replay` set to `{ [replayKey("erp-read:get_po",{po_id:"PO-1"})]: "row" }`. Executing the model tool `erp-read__get_po({po_id:"PO-1"})` returns `"row"`, `callTool` is not called, and `toolbox.calls[0]` matches `{ outcome:"ok", replayed:true }`.
  - `"replayKey ignores key order"`: `replayKey("a:b",{x:1,y:{b:2,a:1}}) === replayKey("a:b",{y:{a:1,b:2},x:1})`.
  - `"model tool calls carry the AI SDK toolCallId as id"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/agent-kit`. Expected: the 4 new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above. The AI SDK passes `{ toolCallId }` as the second argument of `execute`. Thread it into `call()` through a new optional `id` parameter.
- [ ] **Step 4: Run** `pnpm test`. Expected: all PASS, and the existing `withHeartbeat` callers still compile with the one-argument callback.
- [ ] **Step 5: Commit** with message `agent-kit: heartbeat progress details and tool replay cache`.

### Task 2: Resolver — resume `gatherEvidence` without repeating tool calls

**Files:**
- Create: `agents/general/invoice-exception-resolver/src/progress.ts`
- Modify: `…/src/activities.ts:153-195` (`gatherEvidence`); `readInvoice`, `proposeResolution` and `draftMessage` call `progress({ note })` once at start
- Test: `agents/general/invoice-exception-resolver/test/progress.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 `withHeartbeat(progress)`, `McpToolboxOptions.replay`, `replayKey`, `ToolCallRecord.id`.
- Produces (heartbeat details, read by the API in Task 4):
  ```ts
  export const ProgressSchema = z.object({
    v: z.literal(1),
    note: z.string().optional(),
    calls: z.array(z.custom<ToolCallRecord>()),                 // completed so far, in order
    results: z.array(z.object({ key: z.string(), text: z.string() })), // gatherEvidence only
  });
  export type Progress = z.infer<typeof ProgressSchema>;
  export const PROGRESS_MAX_BYTES = 256 * 1024;
  export function addCall(p: Progress, record: ToolCallRecord, resultText?: string): Progress; // drops resultText once JSON size would exceed PROGRESS_MAX_BYTES; keeps the call record
  export function resumeFrom(details: unknown): { replay: Map<string, string>; calls: ToolCallRecord[] }; // invalid → empty
  ```
- Behaviour: `gatherEvidence` reads `Context.current().info.heartbeatDetails` and calls `resumeFrom`. It passes `replay` to `withToolbox`, adds each `onResult` (and each replayed record) to the progress, and calls `progress()`. Evidence excerpts for replayed calls are rebuilt from the cached text, so the final `evidence` equals an uninterrupted run's.

- [ ] **Step 1: Write failing tests** (`progress.test.ts`, using `MockActivityEnvironment` with `heartbeatDetails` set and the existing in-memory MCP and mock model helpers in this package's tests):
  - `"addCall stops storing results past 256 KB but keeps call records"`
  - `"resumeFrom ignores malformed or wrong-version details"`: `resumeFrom({v:2})` and `resumeFrom("x")` both return an empty map.
  - `"gatherEvidence resumed from heartbeat details calls no tool twice"`: a first run records progress for 2 calls. A second run is given those details, and the server spy for those 2 calls stays at 1 call each across both runs. The returned `evidence` deep-equals an uninterrupted run with the same mock model script.
- [ ] **Step 2: Run** `pnpm vitest run agents/general/invoice-exception-resolver/test/progress.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `progress.ts` and the activity changes.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS, including the existing `workflow.test.ts`.
- [ ] **Step 5: Commit** with message `invoice resolver: resume evidence gathering from heartbeat details`.

### Task 3: Resolver — narration on every timeline step

**Files:**
- Modify: `…/src/types.ts:98` (`TimelineEntry.narration?: string`), `…/src/schemas.ts` (`InvoiceFieldsSchema`, `ProposalSchema` and `MessageSchema` gain `narration: z.string().max(300).describe("1–2 plain-language first-person sentences for an observer; only facts you saw")`), `…/src/prompts/index.ts` (`EVIDENCE_SYSTEM` asks the final answer to end with a line `NARRATION: <1–2 sentences>`), `…/src/activities.ts` (return `narration`; `gatherEvidence` parses and strips the `NARRATION:` line from `notes`), `…/src/workflows/resolve.workflow.ts` (`step(name, detail, state, narration?)`)
- Test: `agents/general/invoice-exception-resolver/test/workflow.test.ts`

**Interfaces:**
- Produces: `TimelineEntry { name; at; detail; state; narration?: string }`. Rule-step templates, in `resolve.workflow.ts` as a `narrate` object:
  - Match: `` `The three-way match ${status === "matched" ? "passed" : `flagged ${codes}`}.` ``
  - Route: `needsPerson ? "This needs a person's approval: ${reasons}." : "The rules allow posting this without a person."`
  - Waiting for approval: `"Waiting for a reviewer to approve, send back or escalate."`
  - Post resolution: `` `Posting the ${action} for ${amount} to the ERP.` ``
  - Confirm: `` `The invoice is now ${status}.` ``
  - Waiting for receipt: `"No goods receipt yet. I'll re-check daily and escalate on day ${escalateDays}."`
  - LLM steps use the activity's `narration`. If it's missing or blank, the entry has no narration.
- No `patched()` guard: query state only.

- [ ] **Step 1: Write failing tests**
  - `"every timeline entry of an approved run has narration"`: extend the mock activities to return `narration: "n"`, and expect all entries in a routed-and-approved run to have a non-empty `narration`.
  - `"gatherEvidence strips the NARRATION line from notes"`: unit test of an exported `splitNarration(text): { notes: string; narration?: string }`.
- [ ] **Step 2: Run** `pnpm vitest run agents/general/invoice-exception-resolver`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` and the existing evals smoke if the package has one (`pnpm -F @agents/invoice-exception-resolver run eval -- --dry`, if present). Expected: PASS.
- [ ] **Step 5: Commit** with message `invoice resolver: plain-language narration per step`.

### Task 4: API — `GET /api/cases/:workflowId/live`

**Files:**
- Create: `apps/api/src/live.ts`
- Modify: `apps/api/src/sources.ts` (`TemporalSource` gains `describe` and `history`, implemented in `temporalSource`), `apps/api/src/app.ts` (route)
- Test: `apps/api/test/live.test.ts` (new), using the fake `TemporalSource` style from `app.test.ts`

**Interfaces:**
- Produces (web Task 6 mirrors these types in `apps/web/src/api.ts`):
  ```ts
  // sources.ts
  describe?(workflowId: string): Promise<RunDescription | undefined>;
  history?(workflowId: string): Promise<temporal.api.history.v1.IHistoryEvent[]>;
  interface RunDescription { runId: string; status: string; startTime: string; closeTime?: string; pending: PendingActivity[] }
  interface PendingActivity { activityId: string; activityType: string; attempt: number; state: string; scheduledTime?: string; lastStartedTime?: string; lastWorkerIdentity?: string; lastFailure?: { message: string; timeoutType?: string }; heartbeat?: unknown /* decoded with defaultPayloadConverter */ }
  // live.ts
  interface EngineEvent { id: number; at: string; type: string; attrs: Record<string, string | number>; activityType?: string; kind?: "retry" | "failover" | "timer" | "worker" }
  export function condenseHistory(events: IHistoryEvent[], after: number): EngineEvent[];
  export function classifyFailover(p: PendingActivity, events: EngineEvent[]): "retry" | "failover" | undefined; // failover: lastFailure.timeoutType HEARTBEAT|START_TO_CLOSE, or identity changed between attempts
  interface LiveResponse { status; runId; startTime; closeTime?; workerIdentity?; state: unknown | null; events: EngineEvent[]; pending: (PendingActivity & { kind?: "retry" | "failover" })[]; cursor: number; demoControls: boolean }
  ```
- `condenseHistory` keeps the event type name without the `EVENT_TYPE_` prefix, in PascalCase (for example `ActivityTaskScheduled`). Attributes kept: `activityType`, `attempt`, `identity`, `startToCloseTimeout`, `heartbeatTimeout`, `retryMaxAttempts`, `timeoutType`, `failure` (message, 200 chars), and timer `startToFireTimeout`. Activity events carry `activityType`, resolved through `scheduledEventId` for Started/Completed/Failed/TimedOut.
- Route: `GET /api/cases/:workflowId/live?after=<n>` returns 400 if `!ID.test(id)` or there's no built agent. It returns 404 if describe returns undefined. `state` comes from `temporal.query(id, agent.stateQuery)`, with a catch returning `null`.

- [ ] **Step 1: Write failing tests** in `live.test.ts`:
  - `"condenseHistory maps activity events to their activity type and filters by after"`, using a fixture history of 15 events.
  - `"classifyFailover: heartbeat timeout → failover; plain error → retry"`.
  - `"live returns state null but events and pending when the query throws"` (Review Focus 1).
  - `"live rejects queue and unknown workflow ids with 400"` (Review Focus 2).
  - `"live bypasses the running-case cache"`: two calls produce two query calls.
- [ ] **Step 2: Run** `pnpm vitest run apps/api`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `temporalSource`, use `handle.describe()` and read `raw.pendingActivities`. Use `handle.fetchHistory()`. Both use the existing `withTimeout(…, 5_000)`.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** with message `api: live endpoint merging query, history and pending activities`.

### Task 5: API — demo controls (sample case, kill worker)

**Files:**
- Create: `apps/api/src/demo.ts`
- Modify: `apps/api/src/sources.ts` (`KubernetesSource` gains `workerPods(): Promise<{ name: string; ready: boolean }[]>` and `deletePod(name: string): Promise<void>`, with `?gracePeriodSeconds=0`), `apps/api/src/app.ts` (`AppDeps.demo?: { erp: ErpDemoSource }`; register the demo routes only when `deps.demo` is set; `/api/me` adds `demoControls: !!deps.demo` and `temporalUiUrl?: string` from env `TEMPORAL_UI_URL`), `apps/api/src/main.ts` (build `deps.demo` when `process.env.DEMO_CONTROLS === "true"`, from `ERP_DEMO_URL`), `apps/api/package.json` (add `pg` and `@types/pg`, latest versions at least 2 weeks old)
- Test: `apps/api/test/demo.test.ts` (new)

**Interfaces:**
- Consumes: Task 4 `describe()` (pending activities and `lastWorkerIdentity`).
- Produces:
  - `interface ErpDemoSource { cloneException(templateInvoiceId: string): Promise<{ invoiceId: string; exceptionId: string }> }`. In one transaction: `nextId = max(numeric part of erp.invoices.id) + 1`. Copy the `erp.invoices` row (new `id`, the same `document_path`, PO and vendor) and its `erp.invoice_lines`. Insert `erp.exceptions` (`EX-<nextId>`, `status 'open'`, the same `reason_codes`, `raised_on current_date`). On `23505`, retry once.
  - `POST /api/demo/sample-case` → `{ workflowId }`. The template is `DEMO_INVOICE_ID` (`INV-20931`). It starts `resolveInvoiceException` on task queue `invoice-exception-resolver` with workflow id `invoiceId.toLowerCase()` and input `{ exceptionId, invoiceId }`.
  - `POST /api/demo/kill-worker` `{ workflowId }` → `{ pod }`. It finds the pending activity whose `activityType` is in `MODEL_ACTIVITIES = ["readInvoice","gatherEvidence","proposeResolution","draftMessage"]`. If none, 409 `{ error: "no model activity running" }`. The pod is `lastWorkerIdentity.split("@").pop()` if it's among `workerPods()`, otherwise the first ready pod.
  - Without `deps.demo`: both routes 404.

- [ ] **Step 1: Write failing tests:**
  - `"demo routes 404 when demo controls are off"`
  - `"kill-worker deletes the pod named in the pending model activity's identity"`
  - `"kill-worker returns 409 when no model activity is pending"` (Review Focus 3)
  - `"sample-case starts resolveInvoiceException with the cloned ids"`
  - `"two sample-case calls get distinct workflow ids"` (Review Focus 4; fake `ErpDemoSource` counter)
  - `ErpDemoSource` SQL is not unit-tested. It's covered by the k3d check in Task 9.
- [ ] **Step 2: Run** `pnpm vitest run apps/api`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** with message `api: demo controls for sample cases and worker kill`.

### Task 6: Platform — demo-controls component and ERP demo role

**Files:**
- Create: `platform/k8s/components/demo-controls/kustomization.yaml` (`kind: Component`), `worker-replicas.yaml` (patch `worker` → `replicas: 2`), `api-env.yaml` (patch `api`: `DEMO_CONTROLS=true`, and `ERP_DEMO_URL` from Secret `pg-erp-demo`, assembled as `postgres://$(user):$(password)@agents-pg-rw:5432/erp`), `rbac.yaml` (Role `demo-worker-killer`: `pods` get/list/delete; RoleBinding to SA `api`), `networkpolicy.yaml` (`postgres-from-api-demo`: ingress to `cnpg.io/cluster: agents-pg` on 5432 from `app.kubernetes.io/name: api`)
- Modify: `platform/k8s/overlays/local/kustomization.yaml` and `platform/k8s/overlays/gke/kustomization.yaml` (`components: [../../components/demo-controls]`), `platform/services/postgres/cluster.yaml` (managed role `erp_demo`, secret `pg-erp-demo`), `agents/general/invoice-exception-resolver/src/data/sql.ts` (grants: `SELECT ON ALL TABLES IN SCHEMA erp`, `INSERT ON erp.invoices, erp.invoice_lines, erp.exceptions` to `erp_demo`), `scripts/lib/k8s.sh:191` (add `pg-erp-demo:erp_demo` to the loop)
- Test: render checks

- [ ] **Step 1: Render both overlays** with `kubectl kustomize platform/k8s/overlays/local > /tmp/local.yaml` and the same for `gke` (use a copy of `cluster.env.example` and `images.env.example` if the real env files are absent). Expected: success. `grep -c "name: demo-worker-killer"` gives 2 (Role and RoleBinding). The worker Deployment shows `replicas: 2`. The api env has `DEMO_CONTROLS`.
- [ ] **Step 2: Check the seed** with `pnpm test` (the data tests cover `seedSql`). Add `"seed grants erp_demo insert on invoices, invoice_lines, exceptions"` to `data.test.ts` as a string assertion, and run it to see it pass.
- [ ] **Step 3: Commit** with message `platform: demo-controls component (2 workers, kill RBAC, ERP demo role)`.

### Task 7: Web — live model (graph definition, reducer, polling hook)

**Files:**
- Create: `apps/web/src/live/graphs.ts`, `apps/web/src/live/reduce.ts`, `apps/web/src/live/useLive.ts`
- Modify: `apps/web/src/api.ts` (mirror `LiveResponse`, `EngineEvent`, `PendingActivity`; `Me.demoControls`)
- Test: `apps/web/test/live.test.ts` (new)

**Interfaces:**
- Consumes: Task 4 `LiveResponse`.
- Produces:
  ```ts
  // graphs.ts
  interface GraphNode { id: string; label: string; activities: string[]; timeline: string[]; gate?: true; model?: string }
  interface LiveGraph { nodes: GraphNode[]; branch?: { from: string; node: GraphNode } }
  export const LIVE_GRAPHS: Record<string, LiveGraph>; // "invoice-exception-resolver" only
  // nodes: match[runMatch|"Match"], read[readInvoice|"Read invoice PDF"], evidence[gatherEvidence|"Gather evidence"],
  //        propose[proposeResolution,computeAdjustment|"Propose"…], route[|"Route"], gate[gate,|"Waiting for approval","Approved","Sent back","Escalated by reviewer"],
  //        finish[draftMessage,queueMessage,postResolution,confirmInvoice|"Message queued","Post resolution","Confirm"]
  // branch: from match → hold[setHold|"Waiting for receipt","Invoice on hold","Receipt found"]
  export function toolPhrase(ref: string, args: Record<string, unknown>): string; // e.g. "Looking up purchase order PO-88213"; fallback "Calling <ref>"
  // reduce.ts
  type NodeStatus = "pending" | "now" | "done" | "error" | "skipped";
  interface LiveView { nodes: Record<string, { status: NodeStatus; ms?: number; costUsd?: number; model?: string; tools: number; retries: number; failovers: number; eventIds: number[] }>;
                       feed: FeedItem[]; events: EngineEvent[]; status: string; elapsedMs: number; costUsd: number; toolCalls: number; canKill: boolean; legacy: boolean }
  interface FeedItem { key: string; at: string; node: string; say: string; how?: string; evidence?: string; pending?: true }
  export function reduceLive(graph: LiveGraph, res: LiveResponse, now: number): LiveView;
  export function replayFrames(res: LiveResponse): { at: number; res: LiveResponse }[]; // successive truncations by timestamp; waits >10s compressed to 2s
  // useLive.ts
  export function useLive(workflowId: string, mode: "live" | "replay"): { view?: LiveView; speed: 1|4|16; setSpeed; paused: boolean; setPaused; position: number; seek(ms: number): void; error?: string };
  ```
- Feed rules: one item per timeline entry with `narration` (say = narration, how = detail plus usage for that step). Pending heartbeat calls not yet in `state.toolCalls` become items with `say = toolPhrase(...)` and `pending: true`, deduped by `ToolCallRecord.id`. If no entry has narration, `legacy = true` and say = detail.

- [ ] **Step 1: Write failing tests** with fixture `LiveResponse`s:
  - `"marks completed nodes done and the pending activity's node now"`
  - `"counts retry and failover badges from pending kind and events"`
  - `"pending heartbeat tool calls appear once and dedupe with completed calls"`
  - `"legacy runs without narration use detail and set legacy"`
  - `"state null still yields node statuses from events"` (Review Focus 1)
  - `"replayFrames compresses a 3h review wait to 2s"`
  - `"canKill is true only while a model activity is pending"`
- [ ] **Step 2: Run** `pnpm vitest run apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement.** `useLive` uses `fetch` with a `cursor` at 1s while `status === "running"`. Events are appended and the rest is replaced. In replay mode it fetches once with `after=0` and steps `replayFrames` on `requestAnimationFrame` at the chosen speed.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** with message `web: live run model, reducer and polling hook`.

### Task 8: Web — the Live Run screen and entry points

**Files:**
- Create: `apps/web/src/live/LiveRun.tsx`, `RunGraph.tsx`, `AgentFeed.tsx`, `EngineDrawer.tsx`, `ReplayControls.tsx`
- Modify: `apps/web/src/App.tsx:35-41` (`readHash` matches `/case/<id>/live` → `{ view: "agent", agent, case, live: true }`; render `LiveRun` full-screen instead of `AgentView`), `apps/web/src/StepStrip.tsx` (optional `action?: { label: string; href: string }` rendered right-aligned; the strip is clickable when `href` is set), `apps/web/src/CaseView.tsx:367` (pass `◉ Watch live` when running, otherwise `▶ Replay run`, for the invoice agent), `apps/web/src/CaseTable.tsx` (running rows: a pulsing `● Live` link to `/live`), `apps/web/src/AgentView.tsx` (when `me.demoControls`: a "Run a sample invoice" button that POSTs `/api/demo/sample-case` and navigates to `#/agent/invoice-exception-resolver/case/<workflowId>/live`), `apps/web/src/styles.css` (a `.live-*` block using the existing tokens)
- Test: `apps/web/test/labels.test.ts` (route parsing), plus a manual check in Task 9

**Interfaces:**
- Consumes: Task 7 `useLive`, `LIVE_GRAPHS`, `LiveView`.
- Layout and copy follow mockup v3 exactly:
  - The header bar has the case ref, `LIVE`, `REPLAY` or the final status, plus vendor, invoice, amount and the variance tag; then elapsed, LLM cost and tool calls; `⚙ Engine · <n>`; and `⚡ Kill worker`, shown when `demoControls` is on and disabled with the title "Only during a model step" unless `canKill`.
  - Graph node badges are `↻ n retry` and `⚡ failover`. Clicking a badge opens the drawer filtered to that node, scrolled to `eventIds`.
  - The feed filter chip reads "filter: <node> ×".
  - The drawer has Grouped / Raw / JSON tabs. JSON fetches `?raw=<id>` lazily, or shows the condensed event if the raw call isn't implemented. "Open in Temporal UI ↗" is shown only if `/api/me` returns `temporalUiUrl`. It's collapsed by default to a strip with the last event and counts.
  - The legacy note reads "Recorded before narration. Showing step details."
  - A non-invoice agent shows "Live view isn't available for this agent" with a back link (Review Focus 2).
- Esc closes the drawer if it's open, otherwise goes back to the case.

- [ ] **Step 1: Write a failing test** `"readHash parses the live route"` (export `readHash` from `App.tsx`, or move it to `routes.ts` if importing `App` in a test pulls in the DOM).
- [ ] **Step 2: Run** `pnpm vitest run apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and entry points.
- [ ] **Step 4: Run** `pnpm test` and `pnpm -F @agents/web build`. Expected: PASS with no type errors.
- [ ] **Step 5: Smoke against a local API** with `pnpm -F @agents/web dev` and `API_URL` pointing at k3d once Task 9 is up. The check is in Task 9.
- [ ] **Step 6: Commit** with message `web: Live Run screen, replay and entry points`.

### Task 9: Deploy to k3d and run the demo end to end

**Files:** none (fix-forward commits if issues are found)

- [ ] **Step 1:** In WSL, from the `~/repos` checkout (see memory "WSL deploy checkout"), run `scripts/local/build-push.sh`, then `scripts/local/load-secrets.sh` (creates `pg-erp-demo`), then `LOCAL_MODELS=flash-lite scripts/local/apply-k8s.sh`, then `scripts/local/erp-load.sh` (reloads the seed with the new grants). Expected: all succeed, `kubectl -n agents get deploy worker` shows `2/2`, and the api pod has `DEMO_CONTROLS=true`.
- [ ] **Step 2:** In the browser pane at `http://localhost`, go to Agents → Invoice Exception Resolver → "Run a sample invoice". Expected: you land on `/live`, and the graph and feed advance within about 1s of each step.
- [ ] **Step 3:** During "Gather evidence", press ⚡ Kill worker. Expected: within about 25s the node shows `⚡ failover`, the drawer shows the heartbeat timeout and the new identity, the feed continues, and the worker logs show no repeated MCP call for calls completed before the kill (check `kubectl logs` on the mcp-erp-read pod for duplicate request ids, or the case's `toolCalls` with `replayed: true`).
- [ ] **Step 4:** Approve the case, then open "▶ Replay run" from the case page. Expected: it plays at 4×, the review wait is compressed to 2s, and scrub and speed work. Open an old pre-change case and expect the legacy note.
- [ ] **Step 5:** Check that both themes and a 1280×720 projector viewport render without overflow.
- [ ] **Step 6:** Commit any fixes with message `fix: <what>`.

### Task 10: Deploy to GKE and verify behind IAP

- [ ] **Step 1:** In WSL, run `scripts/gke/build-push.sh`, then `scripts/gke/apply-k8s.sh`, then reload the ERP seed the way the GKE scripts do. Expected: success, with 2 worker pods on spot nodes.
- [ ] **Step 2:** Repeat Task 9 Steps 2–4 through the IAP URL. Expected: the same results, and polling at 1s gives no 5xx or IAP re-auth loops (check the browser network panel).
- [ ] **Step 3:** Record the session start and end times in memory ("GKE smoke session") for billing reconciliation.
- [ ] **Step 4:** Open a PR from `feat/live-run-view` to `main`.
