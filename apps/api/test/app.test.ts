import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../dist/app.js";
import type { KubernetesSource, LiteLLMSource, RunInfo, TemporalSource } from "../dist/sources.js";

const now = new Date().toISOString();
const runs: RunInfo[] = [
  { workflowId: "inv-20931", runId: "r2", type: "resolveInvoiceException", status: "RUNNING", startTime: now },
  // An older run of the same case (before a reset): must not show twice.
  { workflowId: "inv-20931", runId: "r1", type: "resolveInvoiceException", status: "TERMINATED", startTime: "2026-11-01T00:00:00.000Z", closeTime: "2026-11-01T01:00:00.000Z" },
  { workflowId: "inv-20556", runId: "r3", type: "resolveInvoiceException", status: "COMPLETED", startTime: now, closeTime: now },
];
const states: Record<string, unknown> = {
  "inv-20931": {
    invoiceId: "INV-20931",
    stage: "awaiting_review",
    proposal: { exceptionType: "price_variance", action: "accept_variance" },
    route: { needsPerson: true, path: "post", reasons: ["accept_variance always needs a person", "amount 1284.00 is over the 1000.00 approval line"] },
    timeline: [{ name: "Waiting for approval", detail: "", at: now }],
    usage: [{ costUsd: 0.004 }, { costUsd: 0.001 }],
    toolCalls: [{ ref: "erp-write:post_resolution", caller: "model", outcome: "refused", at: now }],
  },
  "inv-20556": { invoiceId: "INV-20556", stage: "done", status: "blocked", reasons: ["instructions in the invoice"], timeline: [], usage: [], toolCalls: [] },
};

const temporal: TemporalSource = {
  listRuns: vi.fn(async (q: string) => (q.includes("resolveInvoiceException") ? runs : q.includes("WorkflowId = 'inv-20931'") ? [runs[0]!] : [])),
  count: vi.fn(async () => 3),
  query: vi.fn(async (id: string) => states[id] as never),
  update: vi.fn(async () => ({ accepted: true, draftVersion: 1 }) as never),
  signal: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
  healthy: vi.fn(async () => true),
};
const litellm: LiteLLMSource = {
  keys: vi.fn(async () => [{ alias: "agent-invoice-exception-resolver", spend: 2.85, maxBudget: 3, resetsAt: null }]),
  healthy: vi.fn(async () => true),
};
const kubernetes: KubernetesSource = {
  deployments: vi.fn(async (names: string[]) => names.map((name) => ({ name, ready: 1, replicas: 1 }))),
  postgresReady: vi.fn(async () => true),
};

const app = buildApp({ temporal, litellm, kubernetes });
beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe("portal API", () => {
  it("lists every agent, with live figures for built ones and Coming soon for the rest", async () => {
    const agents = (await app.inject("/api/agents")).json();
    expect(agents).toHaveLength(6);
    const inv = agents.find((a: { id: string }) => a.id === "invoice-exception-resolver");
    expect(inv).toMatchObject({ status: "needs_review", needsPerson: 1, runs24h: 3, spend: { spentUsd: 2.85, budgetUsd: 3 } });
    expect(agents.filter((a: { status: string }) => a.status === "coming_soon")).toHaveLength(4);
  });

  it("lists a case once, from its newest run", async () => {
    const cases = (await app.inject("/api/agents/invoice-exception-resolver/cases")).json();
    expect(cases.map((c: { workflowId: string }) => c.workflowId)).toEqual(["inv-20931", "inv-20556"]);
    expect(cases[0]).toMatchObject({ needsPerson: true, title: "INV-20931 · price variance", costUsd: 0.005 });
    expect(cases[1]).toMatchObject({ status: "blocked", needsPerson: false });
  });

  it("sends a review as the signed-in user, from the IAP header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cases/inv-20931/review",
      headers: { "x-goog-authenticated-user-email": "accounts.google.com:reviewer@example.com" },
      payload: { approved: true, reviewer: "someone-else" },
    });
    expect(res.statusCode).toBe(200);
    expect(temporal.update).toHaveBeenCalledWith("inv-20931", "review", { approved: true, reviewer: "reviewer@example.com" });
  });

  it("refuses bad ids and malformed reviews, and passes on the workflow's refusal", async () => {
    expect((await app.inject({ method: "POST", url: "/api/cases/..%2Fx/review", payload: { approved: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/cases/inv-20931/review", payload: { approved: "yes" } })).statusCode).toBe(400);
    vi.mocked(temporal.update).mockRejectedValueOnce(new Error("not waiting for review"));
    const refused = await app.inject({ method: "POST", url: "/api/cases/inv-20931/review", payload: { approved: true } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("not waiting for review");
  });

  it("builds Mission Control: health, figures, boundary events and servers", async () => {
    const m = (await app.inject("/api/mission")).json();
    expect(m.platform.every((p: { ok: boolean }) => p.ok)).toBe(true);
    expect(m.kpis).toMatchObject({ agentsLive: 2, agentsTotal: 6, needPerson: 1, stoppedByRule24h: 1, spendUsd: 2.85 });
    const kinds = m.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["Guardrail", "Allow-list", "Threshold", "Budget"]));
    expect(m.servers.map((s: { name: string }) => s.name)).toContain("mcp-match-engine");
  });
});
