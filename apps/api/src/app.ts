import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
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
  detail: string;
}

type AnyState = Record<string, any>;
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** IAP puts the signed-in user in x-goog-authenticated-user-email ("accounts.google.com:me@x"). */
export function identity(req: FastifyRequest, fallback = "local-user"): string {
  const h = req.headers["x-goog-authenticated-user-email"];
  return typeof h === "string" && h ? h.replace(/^accounts\.google\.com:/, "") : fallback;
}

export function summarize(agent: AgentEntry, run: RunInfo, state: AnyState | undefined): CaseSummary {
  const temporalStatus = run.status;
  const base = { workflowId: run.workflowId, agentId: agent.id, temporalStatus, startedAt: run.startTime, closedAt: run.closeTime };
  if (!state) {
    return { ...base, ref: run.workflowId, title: run.workflowId, stage: temporalStatus === "RUNNING" ? "starting" : "done", status: null, needsPerson: false, costUsd: 0, detail: temporalStatus.toLowerCase() };
  }
  const cost = Array.isArray(state.usage) ? state.usage.reduce((s: number, u: AnyState) => s + (u.costUsd ?? 0), 0) : 0;
  const stopped = temporalStatus !== "RUNNING" && temporalStatus !== "COMPLETED";
  if (agent.id === "research-summarize") {
    return {
      ...base,
      ref: run.workflowId,
      title: String(state.question ?? state.draft?.summary?.slice(0, 60) ?? run.workflowId),
      stage: stopped ? temporalStatus.toLowerCase() : String(state.stage),
      status: stopped ? temporalStatus.toLowerCase() : state.stage === "done" ? "done" : null,
      needsPerson: !stopped && state.stage === "awaiting_review",
      costUsd: cost,
      detail: state.draftVersion ? `draft ${state.draftVersion}` : String(state.stage),
    };
  }
  const type = state.proposal?.exceptionType ?? state.match?.exceptionTypes?.[0] ?? "exception";
  const last = Array.isArray(state.timeline) ? state.timeline.at(-1) : undefined;
  return {
    ...base,
    ref: String(state.invoiceId ?? run.workflowId),
    title: `${state.invoiceId ?? run.workflowId} · ${String(type).replace(/_/g, " ")}`,
    stage: stopped ? temporalStatus.toLowerCase() : String(state.stage),
    status: stopped ? temporalStatus.toLowerCase() : (state.status ?? null),
    needsPerson: !stopped && state.stage === "awaiting_review",
    costUsd: cost,
    detail: last ? `${last.name}${last.detail ? `: ${last.detail}` : ""}` : String(state.stage),
  };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const { temporal, litellm, kubernetes } = deps;

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
        const state = await stateOf(agent, run);
        return { summary: summarize(agent, run, state), state };
      }),
    );
  }

  const spendByAlias = async () => {
    try {
      return new Map((await litellm.keys()).map((k) => [k.alias, k]));
    } catch {
      return new Map();
    }
  };

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/me", async (req) => ({ user: identity(req, deps.localUser) }));

  /** Every agent, with live figures for the built ones. */
  app.get("/api/agents", async () => {
    const spend = await spendByAlias();
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
    const state = await stateOf(agent, run);
    return { agentId: agent.id, summary: summarize(agent, run, state), state: state ?? null };
  });

  const ReviewBody = z.object({ approved: z.boolean(), feedback: z.string().max(2_000).optional() });
  app.post<{ Params: { workflowId: string } }>("/api/cases/:workflowId/review", async (req, reply) => {
    const { workflowId } = req.params;
    const body = ReviewBody.safeParse(req.body);
    if (!ID.test(workflowId) || !agentForWorkflow(workflowId)?.built || !body.success) return reply.code(400).send({ error: "invalid review" });
    try {
      const ack = await temporal.update(workflowId, "review", { ...body.data, reviewer: identity(req, deps.localUser) });
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
    }
    for (const a of built) {
      const k = a.keyAlias ? spend.get(a.keyAlias) : undefined;
      if (k?.maxBudget && k.spend / k.maxBudget >= 0.9) events.push({ kind: "Budget", agentId: a.id, workflowId: "", text: `${a.name} at ${Math.round((100 * k.spend) / k.maxBudget)}% of its budget`, at: new Date().toISOString() });
    }
    events.sort((x, y) => y.at.localeCompare(x.at));

    const keys = built.map((a) => (a.keyAlias ? spend.get(a.keyAlias) : undefined)).filter(Boolean);
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
