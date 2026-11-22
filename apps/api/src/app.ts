import { daysOf, deadlineOf, decisionOf, personReasonsOf, researchOf, thresholdOf, writesOf, type PersonReason } from "./decision.js";
import { evidenceSummaries } from "./evidence.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { registerDemo, type ErpDemoSource } from "./demo.js";
import { IAP_JWT_HEADER, isCrossSite, type IapVerifier } from "./iap.js";
import { classifyFailover, condenseHistory, lastWorker } from "./live.js";
import { AGENTS, MCP_SERVERS, agentById, agentForWorkflow, type AgentEntry } from "./registry.js";
import type { KubernetesSource, LiteLLMSource, RunInfo, TemporalSource } from "./sources.js";

export interface AppDeps {
  temporal: TemporalSource;
  litellm: LiteLLMSource;
  kubernetes: KubernetesSource;
  /** Built web UI to serve at /, if present. */
  webDir?: string;
  /** Who is signed in, when there is no identity header (local development). */
  localUser?: string;
  /** Where each agent's skills live: <skillsDir>/<agentId>/<skill>/SKILL.md. */
  skillsDir?: string;
  /** What one case costs to work by hand (USD), for the comparison on the overview. Unset: not shown. */
  manualCostPerCaseUsd?: number;
  /** Demo controls (sample case, kill worker). Set only when DEMO_CONTROLS=true; otherwise the routes don't exist. */
  demo?: { erp: ErpDemoSource };
  /** Temporal Web UI base URL, for the Live Run drawer's link. */
  temporalUiUrl?: string;
  /**
   * Checks Identity-Aware Proxy's signed token on every request (all but /healthz). Set on GKE;
   * unset for local development, where there is no IAP and the identity is `localUser`.
   */
  iap?: IapVerifier;
}

/** One row in a case list, the same shape for every agent. */
export interface CaseSummary {
  workflowId: string;
  agentId: string;
  ref: string;
  title: string;
  stage: string;
  status: string | null;
  temporalStatus: string;
  needsPerson: boolean;
  startedAt: string;
  closedAt?: string;
  costUsd: number;
  /** False when the run recorded no model usage (runs from before cost was kept): show "not recorded", not $0. */
  costRecorded?: boolean;
  /** A person approved this against the policy check. */
  overridden?: boolean;
  detail: string;
  /** Why the case stands where it does, in a sentence; empty when the detail already says it. */
  reason?: string;
  /** The money the proposed action moves, in cents. */
  amountCents?: number;
  vendorName?: string;
}

/** Invoice facts for the case page. "erp" when the workflow recorded them; "derived" for runs from before it did. */
export interface CaseFacts {
  source: "erp" | "derived";
  vendorName?: string;
  dueDate?: string;
  lines: Array<{ lineNo: number; itemId?: string; description?: string; quantity?: number; uom?: string; unitPriceCents?: number }>;
}

type AnyState = Record<string, any>;

/**
 * The facts the case page shows. Runs that recorded them (CaseState.facts) are passed through. Older runs
 * did not, so for those the vendor and due date are read from the invoice text the run kept as evidence
 * and the quantity from the match engine's figures. Kept here so the browser never parses documents.
 */
export function factsOf(state: AnyState | undefined): CaseFacts | undefined {
  if (!state) return undefined;
  if (state.facts) return { source: "erp", vendorName: state.facts.vendorName, dueDate: state.facts.dueDate, lines: state.facts.lines ?? [] };
  const pdf = String((state.evidence ?? []).find((e: AnyState) => String(e.source).startsWith("docs:"))?.excerpt ?? "");
  if (!pdf) return undefined;
  const lines = (state.match?.findings ?? [])
    .filter((f: AnyState) => f.lineNo != null && f.details?.invoicedUnitPriceCents > f.details?.poUnitPriceCents && f.amountCents)
    .map((f: AnyState) => {
      const q = f.amountCents / (f.details.invoicedUnitPriceCents - f.details.poUnitPriceCents);
      return { lineNo: Number(f.lineNo), quantity: Math.abs(q - Math.round(q)) < 0.01 ? Math.round(q) : undefined, unitPriceCents: f.details.invoicedUnitPriceCents };
    });
  return { source: "derived", vendorName: pdf.split("\n")[0]?.trim() || undefined, dueDate: /Due date:\s*(\d{4}-\d{2}-\d{2})/i.exec(pdf)?.[1], lines };
}

export interface SkillActions {
  name: string;
  version: string;
  actions: Array<{ action: string; useWhen: string; effect: string }>;
}

/** The action table of a SKILL.md: rows of | `action` | use when | effect |. */
export function parseSkill(markdown: string): SkillActions | undefined {
  const text = markdown.replace(/\r\n/g, "\n");
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const name = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim();
  const version = /^version:\s*"?([^"\n]+)"?$/m.exec(front)?.[1]?.trim();
  if (!name || !version) return undefined;
  const clean = (s: string) => s.replace(/\*\*/g, "").replace(/`/g, "").trim();
  const actions = [...text.matchAll(/^\|\s*`([a-z_]+)`\s*\|([^|]*)\|([^|]*)\|\s*$/gm)].map((m) => ({ action: m[1]!, useWhen: clean(m[2]!), effect: clean(m[3]!) }));
  return { name, version, actions };
}
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** IAP puts the signed-in user in x-goog-authenticated-user-email ("accounts.google.com:me@x"). */
export function identity(req: FastifyRequest, fallback = "local-user"): string {
  const h = req.headers["x-goog-authenticated-user-email"];
  return typeof h === "string" && h ? h.replace(/^accounts\.google\.com:/, "") : fallback;
}

export function summarize(agent: AgentEntry, run: RunInfo, state: AnyState | undefined, ended?: { reason?: string; identity?: string }): CaseSummary {
  const temporalStatus = run.status;
  const base = { workflowId: run.workflowId, agentId: agent.id, temporalStatus, startedAt: run.startTime, closedAt: run.closeTime };
  if (!state) {
    return { ...base, ref: run.workflowId, title: run.workflowId, stage: temporalStatus === "RUNNING" ? "starting" : "done", status: null, needsPerson: false, costUsd: 0, detail: temporalStatus.toLowerCase() };
  }
  const cost = Array.isArray(state.usage) ? state.usage.reduce((s: number, u: AnyState) => s + (u.costUsd ?? 0), 0) : 0;
  const stopped = temporalStatus !== "RUNNING" && temporalStatus !== "COMPLETED";
  const stoppedReason = stopped ? `${temporalStatus === "TERMINATED" || temporalStatus === "CANCELED" ? "Cancelled" : "Stopped"}${ended?.identity ? ` by ${ended.identity}` : ""}: ${ended?.reason || "no reason recorded"}` : undefined;
  if (agent.id === "research-summarize") {
    return {
      ...base,
      reason: stoppedReason,
      ref: run.workflowId.toUpperCase(),
      // The question names the case. Runs from before it was recorded say so instead of quoting the draft.
      title: state.question ? String(state.question) : "Research question not recorded",
      // A run that drafted but recorded no model call ran before cost was kept (replay rebuilds an empty list).
      costRecorded: Array.isArray(state.usage) && (state.usage.length > 0 || !state.draft),
      stage: stopped ? temporalStatus.toLowerCase() : String(state.stage),
      status: stopped ? temporalStatus.toLowerCase() : state.stage === "done" ? "done" : null,
      needsPerson: !stopped && state.stage === "awaiting_review",
      costUsd: cost,
      detail: state.draftVersion ? `draft ${state.draftVersion}` : String(state.stage),
    };
  }
  const type = state.proposal?.exceptionType ?? state.match?.exceptionTypes?.[0] ?? "exception";
  const last = Array.isArray(state.timeline) ? state.timeline.at(-1) : undefined;
  const reasons: string[] = (state.status ? state.reasons : state.route?.reasons) ?? [];
  return {
    ...base,
    reason: stoppedReason ?? (reasons.length ? reasons.join("; ") : undefined),
    amountCents: typeof state.adjustment?.amountCents === "number" ? state.adjustment.amountCents : undefined,
    vendorName: factsOf(state)?.vendorName,
    ref: String(state.invoiceId ?? run.workflowId),
    title: `${state.invoiceId ?? run.workflowId} · ${String(type).replace(/_/g, " ")}`,
    stage: stopped ? temporalStatus.toLowerCase() : String(state.stage),
    status: stopped ? temporalStatus.toLowerCase() : (state.status ?? null),
    needsPerson: !stopped && state.stage === "awaiting_review",
    costUsd: cost,
    ...(decisionOf(state)?.againstPolicy ? { overridden: true } : {}),
    detail: last ? `${last.name}${last.detail ? `: ${last.detail}` : ""}` : String(state.stage),
  };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const { temporal, litellm, kubernetes } = deps;

  // Behind IAP, trust nothing but its signed token. The identity header is rewritten from the
  // verified token, so the rest of the app never reads a value a client could have sent itself.
  // /healthz stays open: load balancer health checks reach the pod directly, without IAP.
  const IDENTITY_HEADER = "x-goog-authenticated-user-email";
  app.addHook("onRequest", async (req, reply) => {
    if (!deps.iap || req.url === "/healthz") return;
    const token = req.headers[IAP_JWT_HEADER];
    try {
      if (typeof token !== "string" || !token) throw new Error("no token");
      const { email } = await deps.iap.verify(token);
      req.headers[IDENTITY_HEADER] = `accounts.google.com:${email}`;
    } catch (error) {
      req.log.warn({ reason: error instanceof Error ? error.message : String(error) }, "request without a valid IAP token refused");
      return reply.code(401).send({ error: "sign-in required" });
    }
  });

  // Requests that change something must come from the portal itself, not from another website
  // riding on the visitor's sign-in.
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    if (isCrossSite(req.headers)) return reply.code(403).send({ error: "cross-site request refused" });
  });

  // Query results: closed runs never change, so cache them by run; running ones for a few seconds.
  const cache = new Map<string, { at: number; value: AnyState | undefined; closed: boolean }>();
  async function stateOf(agent: AgentEntry, run: RunInfo): Promise<AnyState | undefined> {
    const key = `${run.workflowId}/${run.runId}`;
    const hit = cache.get(key);
    if (hit && (hit.closed || Date.now() - hit.at < 3_000)) return hit.value;
    let value: AnyState | undefined;
    try {
      value = await temporal.query<AnyState>(run.workflowId, agent.stateQuery!);
    } catch {
      value = hit?.value; // worker busy or restarting: keep the last answer
    }
    cache.set(key, { at: Date.now(), value, closed: run.status !== "RUNNING" });
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
    return value;
  }

  // Why a stopped run stopped: read once from its history, then kept (a closed run never changes).
  const endings = new Map<string, { reason?: string; identity?: string } | undefined>();
  async function endingOf(run: RunInfo): Promise<{ reason?: string; identity?: string } | undefined> {
    if (run.status === "RUNNING" || run.status === "COMPLETED" || !temporal.termination) return undefined;
    const key = `${run.workflowId}/${run.runId}`;
    if (!endings.has(key)) {
      try {
        endings.set(key, await temporal.termination(run.workflowId, run.runId));
      } catch {
        return undefined; // try again next time
      }
      if (endings.size > 2_000) endings.delete(endings.keys().next().value!);
    }
    return endings.get(key);
  }

  async function casesOf(agent: AgentEntry, limit = 40): Promise<Array<{ summary: CaseSummary; state?: AnyState }>> {
    if (!agent.built) return [];
    const listed = await temporal.listRuns(`WorkflowType = '${agent.caseType}' AND WorkflowId STARTS_WITH '${agent.casePrefix}'`, limit * 3);
    // A case id can have several runs (re-run after a reset); show the newest run of each.
    const newest = new Map<string, RunInfo>();
    for (const run of listed) {
      const seen = newest.get(run.workflowId);
      if (!seen || run.startTime > seen.startTime) newest.set(run.workflowId, run);
    }
    const runs = [...newest.values()].sort((a, b) => b.startTime.localeCompare(a.startTime)).slice(0, limit);
    return Promise.all(
      runs.map(async (run) => {
        const [state, ended] = await Promise.all([stateOf(agent, run), endingOf(run)]);
        return { summary: summarize(agent, run, state, ended), state };
      }),
    );
  }

  const skillCache = new Map<string, SkillActions | undefined>();
  function skillOf(agentId: string, name: string): SkillActions | undefined {
    const key = `${agentId}/${name}`;
    if (!skillCache.has(key)) {
      let parsed: SkillActions | undefined;
      try {
        if (deps.skillsDir) parsed = parseSkill(readFileSync(join(deps.skillsDir, agentId, name, "SKILL.md"), "utf8"));
      } catch {
        parsed = undefined;
      }
      skillCache.set(key, parsed);
    }
    return skillCache.get(key);
  }

  const spendByAlias = async () => {
    try {
      return new Map((await litellm.keys()).map((k) => [k.alias, k]));
    } catch {
      return new Map();
    }
  };

  // Which model each gateway alias routes to; read rarely, since it changes only with the gateway config.
  let modelCache: { at: number; value: Record<string, string> } | undefined;
  const modelsByAlias = async (): Promise<Record<string, string>> => {
    if (modelCache && Date.now() - modelCache.at < 300_000) return modelCache.value;
    try {
      modelCache = { at: Date.now(), value: (await litellm.models?.()) ?? {} };
    } catch {
      modelCache = { at: Date.now(), value: modelCache?.value ?? {} };
    }
    return modelCache.value;
  };

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/me", async (req) => ({
    user: identity(req, deps.localUser),
    source: req.headers["x-goog-authenticated-user-email"] ? "iap" : "local",
    demoControls: !!deps.demo,
    ...(deps.temporalUiUrl ? { temporalUiUrl: deps.temporalUiUrl } : {}),
  }));
  if (deps.demo) registerDemo(app, { temporal, kubernetes, erp: deps.demo.erp });

  /** A skill's action table, for the version on disk. 404 when the run used another version: the portal then shows nothing. */
  app.get<{ Params: { id: string; name: string }; Querystring: { version?: string } }>("/api/agents/:id/skills/:name", async (req, reply) => {
    const agent = agentById(req.params.id);
    if (!agent || !ID.test(req.params.name)) return reply.code(404).send({ error: "no such skill" });
    const skill = skillOf(agent.id, req.params.name);
    if (!skill || (req.query.version && req.query.version !== skill.version)) return reply.code(404).send({ error: "no such skill version" });
    return skill;
  });

  /** Case history across agents: search by reference or vendor, sort, and page. */
  const CasesQuery = z.object({
    agent: z.string().regex(ID).optional(),
    q: z.string().max(100).optional(),
    sort: z.enum(["age", "amount", "cost"]).default("age"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    /** "1": only cases waiting on a person. */
    needs: z.enum(["1"]).optional(),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });
  app.get("/api/cases", async (req, reply) => {
    const query = CasesQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid query" });
    const { agent: agentId, q, sort, dir, offset, limit, needs } = query.data;
    const agents = AGENTS.filter((a) => a.built && (!agentId || a.id === agentId));
    const all = (await Promise.all(agents.map((a) => casesOf(a, 500).catch(() => [])))).flat().map((c) => c.summary);
    const needle = q?.trim().toLowerCase();
    const searched = needle ? all.filter((c) => [c.ref, c.workflowId, c.title, c.vendorName ?? ""].some((v) => v.toLowerCase().includes(needle))) : all;
    const found = needs ? searched.filter((c) => c.needsPerson) : searched;
    const key = (c: CaseSummary) => (sort === "amount" ? Math.abs(c.amountCents ?? 0) : sort === "cost" ? c.costUsd : Date.parse(c.startedAt));
    found.sort((x, y) => (dir === "asc" ? key(x) - key(y) : key(y) - key(x)));
    return { total: found.length, offset, cases: found.slice(offset, offset + limit) };
  });

  /** Every agent, with live figures for the built ones. */
  app.get("/api/agents", async () => {
    const [spend, models] = await Promise.all([spendByAlias(), modelsByAlias()]);
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    return Promise.all(
      AGENTS.map(async (a) => {
        const key = a.keyAlias ? spend.get(a.keyAlias) : undefined;
        let runs24h: number | null = null;
        let needsPerson = 0;
        let running = 0;
        if (a.built) {
          const cases = await casesOf(a).catch(() => []);
          needsPerson = cases.filter((c) => c.summary.needsPerson).length;
          running = cases.filter((c) => c.summary.temporalStatus === "RUNNING").length;
          runs24h = await temporal.count(`WorkflowType = '${a.caseType}' AND WorkflowId STARTS_WITH '${a.casePrefix}' AND StartTime > '${dayAgo}'`).catch(() => null);
        }
        return {
          ...a,
          modelTiers: a.models.split(/\s*·\s*/).filter(Boolean).map((alias) => ({ alias, model: models[alias] ?? null })),
          status: !a.built ? "coming_soon" : needsPerson > 0 ? "needs_review" : running > 0 ? "active" : "idle",
          runs24h,
          needsPerson,
          running,
          spend: key ? { spentUsd: key.spend, budgetUsd: key.maxBudget, resetsAt: key.resetsAt } : null,
        };
      }),
    );
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/cases", async (req, reply) => {
    const agent = agentById(req.params.id);
    if (!agent) return reply.code(404).send({ error: "no such agent" });
    return (await casesOf(agent)).map((c) => c.summary);
  });

  app.get<{ Params: { workflowId: string } }>("/api/cases/:workflowId", async (req, reply) => {
    const { workflowId } = req.params;
    const agent = ID.test(workflowId) ? agentForWorkflow(workflowId) : undefined;
    if (!agent?.built) return reply.code(404).send({ error: "no such case" });
    const [run] = await temporal.listRuns(`WorkflowId = '${workflowId}'`, 1);
    if (!run) return reply.code(404).send({ error: "no such case" });
    const [state, ended] = await Promise.all([stateOf(agent, run), endingOf(run)]);
    const facts = agent.id === "invoice-exception-resolver" ? factsOf(state) : undefined;
    return {
      agentId: agent.id,
      summary: summarize(agent, run, state, ended),
      state: state ?? null,
      facts: facts ?? null,
      evidence: evidenceSummaries(state, facts?.dueDate),
      decision: decisionOf(state) ?? null,
      writes: writesOf(state),
      threshold: thresholdOf(state) ?? null,
      personReasons: personReasonsOf(state),
      deadline: deadlineOf(state, agent.schedule?.reviewDays ?? daysOf(state?.reviewTimeout)) ?? null,
      research: agent.id === "research-summarize" ? (researchOf(state) ?? null) : undefined,
    };
  });

  // Live Run view: polled every second while a case runs, so it skips the state cache.
  const LiveQuery = z.object({ after: z.coerce.number().int().min(0).default(0), raw: z.coerce.number().int().min(1).optional() });
  app.get<{ Params: { workflowId: string }; Querystring: Record<string, string> }>("/api/cases/:workflowId/live", async (req, reply) => {
    const { workflowId } = req.params;
    const agent = ID.test(workflowId) ? agentForWorkflow(workflowId) : undefined;
    const q = LiveQuery.safeParse(req.query);
    if (!agent?.built || !agent.stateQuery || !q.success || !temporal.describe || !temporal.history) return reply.code(400).send({ error: "invalid request" });
    const run = await temporal.describe(workflowId);
    if (!run) return reply.code(404).send({ error: "no such case" });
    const raw = await temporal.history(workflowId);
    if (q.data.raw !== undefined) {
      const event = raw.find((e) => e.id === q.data.raw);
      return event ?? reply.code(404).send({ error: "no such event" });
    }
    let state: unknown = null;
    try {
      state = (await temporal.query(workflowId, agent.stateQuery)) ?? null;
    } catch {
      state = null; // no worker to answer (failover, or an old run): the view draws from history alone
    }
    return {
      status: run.status,
      runId: run.runId,
      startTime: run.startTime,
      closeTime: run.closeTime,
      workerIdentity: lastWorker(raw, run.pending),
      state,
      events: condenseHistory(raw, q.data.after),
      pending: run.pending.map((p) => ({ ...p, kind: classifyFailover(p) })),
      cursor: raw.at(-1)?.id ?? q.data.after,
    };
  });

  const ReviewBody = z.union([
    z.object({ approved: z.boolean(), feedback: z.string().max(2_000).optional() }),
    z.object({ escalate: z.object({ note: z.string().trim().min(1).max(2_000) }).strict() }),
  ]);
  app.post<{ Params: { workflowId: string } }>("/api/cases/:workflowId/review", async (req, reply) => {
    const { workflowId } = req.params;
    const body = ReviewBody.safeParse(req.body);
    const agent = ID.test(workflowId) ? agentForWorkflow(workflowId) : undefined;
    if (!agent?.built || !body.success) return reply.code(400).send({ error: "invalid review" });
    // Approving against the policy needs a reason on the record. The workflow refuses it too; checking here answers first.
    if ("approved" in body.data && body.data.approved && !body.data.feedback?.trim() && agent.stateQuery) {
      const [run] = await temporal.listRuns(`WorkflowId = '${workflowId}'`, 1);
      const state = run ? await stateOf(agent, run) : undefined;
      if (state?.route?.policyFit && state.route.policyFit.fits === false) return reply.code(400).send({ error: "a reason is required when approving against the policy" });
    }
    try {
      // An escalation is neither an approval nor a send-back; the workflow reads the note.
      const decision = "escalate" in body.data ? { approved: false, escalate: body.data.escalate } : body.data;
      const ack = await temporal.update(workflowId, "review", { ...decision, reviewer: identity(req, deps.localUser) });
      cache.clear();
      return ack;
    } catch (error) {
      // The workflow's validator refuses reviews when it isn't waiting, or a rejection has no feedback.
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  const RecheckBody = z.object({ reason: z.string().min(1).max(500) });
  app.post<{ Params: { workflowId: string } }>("/api/cases/:workflowId/recheck", async (req, reply) => {
    const { workflowId } = req.params;
    const body = RecheckBody.safeParse(req.body);
    const agent = ID.test(workflowId) ? agentForWorkflow(workflowId) : undefined;
    if (agent?.id !== "invoice-exception-resolver" || !body.success) return reply.code(400).send({ error: "invalid request" });
    await temporal.signal(workflowId, "recheck", { reason: `${body.data.reason} (${identity(req, deps.localUser)})` });
    cache.clear();
    return { ok: true };
  });

  const QueueBody = z.object({ limit: z.number().int().min(1).max(200).default(20) });
  app.post("/api/agents/invoice-exception-resolver/queue", async (req, reply) => {
    const body = QueueBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid request" });
    const workflowId = `exception-queue-${Date.now()}`;
    await temporal.start("resolveExceptionQueue", "invoice-exception-resolver", workflowId, { limit: body.data.limit });
    return { workflowId };
  });

  /** Everything Mission Control shows. */
  app.get("/api/mission", async () => {
    const built = AGENTS.filter((a) => a.built);
    const [temporalOk, litellmOk, postgresOk, servers, spend, perAgent] = await Promise.all([
      temporal.healthy(),
      litellm.healthy(),
      kubernetes.postgresReady().catch(() => null),
      kubernetes.deployments(MCP_SERVERS.map((s) => s.name)).catch(() => []),
      spendByAlias(),
      Promise.all(built.map(async (a) => ({ agent: a, cases: await casesOf(a, 50).catch(() => []) }))),
    ]);
    const all = perAgent.flatMap(({ agent, cases }) => cases.map((c) => ({ agent, ...c })));
    const dayAgo = Date.now() - 24 * 3600 * 1000;

    const events: Array<{ kind: string; agentId: string; workflowId: string; text: string; at: string }> = [];
    for (const { agent, summary, state } of all) {
      if (!state || agent.id !== "invoice-exception-resolver") continue;
      const at = state.timeline?.at(-1)?.at ?? summary.startedAt;
      if (state.status === "blocked") events.push({ kind: "Guardrail", agentId: agent.id, workflowId: summary.workflowId, text: state.reasons?.[0] ?? "blocked", at });
      if (state.route?.reasons?.includes("possible fraud")) events.push({ kind: "Fraud flag", agentId: agent.id, workflowId: summary.workflowId, text: state.route.reasons.slice(1).join("; ") || "possible fraud", at });
      for (const t of state.toolCalls ?? []) if (t.outcome === "refused") events.push({ kind: "Allow-list", agentId: agent.id, workflowId: summary.workflowId, text: `${t.ref} refused (${t.caller})`, at: t.at });
      const over = state.route?.reasons?.find((r: string) => r.includes("approval line"));
      if (over && summary.needsPerson) events.push({ kind: "Threshold", agentId: agent.id, workflowId: summary.workflowId, text: over, at });
      const d = decisionOf(state);
      if (d?.againstPolicy) events.push({ kind: "Override", agentId: agent.id, workflowId: summary.workflowId, text: `approved against the policy by ${d.reviewer ?? "a reviewer"}${d.approvalReason ? `, giving the reason “${d.approvalReason}”` : ""}`, at: d.approvedAt ?? at });
    }
    for (const a of built) {
      const k = a.keyAlias ? spend.get(a.keyAlias) : undefined;
      if (k?.maxBudget && k.spend / k.maxBudget >= 0.9) events.push({ kind: "Budget", agentId: a.id, workflowId: "", text: `${a.name} at ${Math.round((100 * k.spend) / k.maxBudget)}% of its budget`, at: new Date().toISOString() });
    }
    events.sort((x, y) => y.at.localeCompare(x.at));

    const keys = built.map((a) => (a.keyAlias ? spend.get(a.keyAlias) : undefined)).filter(Boolean);

    // Business figures over the cases loaded above. Every figure is a sum or a median of real cases.
    const inv = all.filter((c) => c.agent.id === "invoice-exception-resolver" && c.state);
    const closed = inv.filter((c) => c.summary.temporalStatus === "COMPLETED");
    const toProposal = inv
      .map((c) => {
        const t: AnyState[] = c.state!.timeline ?? [];
        const at = t.find((e) => /^propose/i.test(String(e.name)))?.at;
        return at && t[0] ? (Date.parse(at) - Date.parse(t[0].at)) / 1000 : NaN;
      })
      .filter((n) => Number.isFinite(n))
      .sort((x, y) => x - y);
    const started = inv.filter((c) => c.summary.costUsd > 0);
    // Rates over a handful of cases mislead: below this many closed cases the overview shows counts only.
    const RATE_FLOOR = 10;
    const costPerCase = started.length ? started.reduce((s, c) => s + c.summary.costUsd, 0) / started.length : null;
    // Closed by the rules alone: no rule sent it to a person, nobody decided it, and it did not end with a specialist.
    const byRuleAlone = (s: AnyState) => !s.reviewer && !s.route?.needsPerson && !["blocked", "escalated", "expired", "rejected_by_reviewer"].includes(String(s.status ?? ""));
    const closedByRule = closed.filter((c) => byRuleAlone(c.state!)).length;
    // Why the other closed cases needed a person: one count per reason (a case can have several).
    const why = new Map<string, PersonReason & { cases: number }>();
    for (const c of closed.filter((x) => !byRuleAlone(x.state!))) {
      for (const { rule: _rule, ...r } of personReasonsOf(c.state)) why.set(r.label, { ...r, cases: (why.get(r.label)?.cases ?? 0) + 1 });
    }
    const value = {
      cases: inv.length,
      awaitingDecisionCents: inv.filter((c) => c.summary.needsPerson).reduce((s, c) => s + Math.abs(c.summary.amountCents ?? 0), 0),
      invoiceValueProcessedCents: closed.reduce((s, c) => s + (c.state!.match?.totals?.invoiceCents ?? 0), 0),
      closed: closed.length,
      closedWithoutPerson: closedByRule,
      rateFloor: RATE_FLOOR,
      closedWithoutPersonPct: closed.length >= RATE_FLOOR ? Math.round((100 * closedByRule) / closed.length) : null,
      whyPerson: [...why.values()].sort((x, y) => y.cases - x.cases),
      medianSecondsToProposal: toProposal.length ? toProposal[Math.floor((toProposal.length - 1) / 2)]! : null,
      costPerCaseUsd: costPerCase,
      manualCostPerCaseUsd: deps.manualCostPerCaseUsd ?? null,
    };
    return {
      platform: [
        { name: "Temporal", ok: temporalOk },
        { name: "LiteLLM gateway", ok: litellmOk },
        { name: "Postgres (CloudNativePG)", ok: postgresOk },
      ],
      kpis: {
        agentsLive: built.length,
        agentsTotal: AGENTS.length,
        running: all.filter((c) => c.summary.temporalStatus === "RUNNING").length,
        needPerson: all.filter((c) => c.summary.needsPerson).length,
        oldestWaitingSince: all.filter((c) => c.summary.needsPerson).map((c) => c.summary.startedAt).sort()[0] ?? null,
        waitingOnOthers: all.filter((c) => c.summary.stage === "waiting").length,
        stoppedByRule24h: all.filter((c) => ["blocked", "escalated"].includes(c.summary.status ?? "") && Date.parse(c.summary.closedAt ?? c.summary.startedAt) > dayAgo).length,
        spendUsd: keys.reduce((s, k) => s + k!.spend, 0),
        budgetUsd: keys.reduce((s, k) => s + (k!.maxBudget ?? 0), 0),
      },
      runs: all
        .map((c) => c.summary)
        .sort((x, y) => y.startedAt.localeCompare(x.startedAt))
        .slice(0, 25),
      events: events.slice(0, 15),
      value,
      servers: MCP_SERVERS.map((s) => ({ ...s, ...(servers.find((d) => d.name === s.name) ?? { ready: 0, replicas: 0 }) })),
    };
  });

  if (deps.webDir && existsSync(deps.webDir)) {
    app.register(fastifyStatic, { root: deps.webDir, wildcard: false });
    // Single-page app: unknown non-API paths get index.html.
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html")));
  }
  return app;
}
