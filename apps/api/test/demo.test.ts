import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../dist/app.js";
import type { ErpDemoSource } from "../dist/demo.js";
import type { KubernetesSource, LiteLLMSource, PendingActivity, RunDescription, TemporalSource } from "../dist/sources.js";

let pending: PendingActivity[] = [];
const temporal: TemporalSource = {
  listRuns: vi.fn(async () => []),
  count: vi.fn(async () => 0),
  query: vi.fn(async () => undefined),
  update: vi.fn(),
  signal: vi.fn(),
  start: vi.fn(async () => undefined),
  healthy: vi.fn(async () => true),
  describe: vi.fn(async (): Promise<RunDescription> => ({ runId: "r", status: "RUNNING", startTime: "2026-11-20T00:00:00Z", pending })),
  history: vi.fn(async () => []),
};
const litellm: LiteLLMSource = { keys: vi.fn(async () => []), healthy: vi.fn(async () => true) };
const kubernetes: KubernetesSource = {
  deployments: vi.fn(async () => []),
  postgresReady: vi.fn(async () => true),
  workerPods: vi.fn(async () => [
    { name: "worker-7d9f", ready: true },
    { name: "worker-a21c", ready: true },
  ]),
  deletePod: vi.fn(async () => undefined),
};
let next = 90_000;
const erp: ErpDemoSource = {
  cloneException: vi.fn(async () => {
    next += 1;
    return { invoiceId: `INV-${next}`, exceptionId: `EX-${next}` };
  }),
};

const on = buildApp({ temporal, litellm, kubernetes, demo: { erp } });
const off = buildApp({ temporal, litellm, kubernetes });
beforeAll(async () => Promise.all([on.ready(), off.ready()]));
afterAll(async () => Promise.all([on.close(), off.close()]));

describe("demo controls", () => {
  it("demo routes 404 when demo controls are off", async () => {
    expect((await off.inject({ method: "POST", url: "/api/demo/sample-case" })).statusCode).toBe(404);
    expect((await off.inject({ method: "POST", url: "/api/demo/kill-worker", payload: { workflowId: "inv-1" } })).statusCode).toBe(404);
    expect((await off.inject("/api/me")).json().demoControls).toBe(false);
    expect((await on.inject("/api/me")).json().demoControls).toBe(true);
  });

  it("kill-worker deletes the pod named in the pending model activity's identity", async () => {
    pending = [{ activityId: "6", activityType: "gatherEvidence", attempt: 1, state: "STARTED", lastWorkerIdentity: "1@worker-a21c" }];
    const res = await on.inject({ method: "POST", url: "/api/demo/kill-worker", payload: { workflowId: "inv-20931" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pod: "worker-a21c" });
    expect(kubernetes.deletePod).toHaveBeenCalledWith("worker-a21c");
  });

  it("kill-worker returns 409 when no model activity is pending", async () => {
    vi.mocked(kubernetes.deletePod!).mockClear();
    pending = [{ activityId: "7", activityType: "postResolution", attempt: 1, state: "STARTED" }];
    const res = await on.inject({ method: "POST", url: "/api/demo/kill-worker", payload: { workflowId: "inv-20931" } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no model activity running" });
    pending = [];
    expect((await on.inject({ method: "POST", url: "/api/demo/kill-worker", payload: { workflowId: "inv-20931" } })).statusCode).toBe(409);
    expect(kubernetes.deletePod).not.toHaveBeenCalled();
  });

  it("sample-case starts resolveInvoiceException with the cloned ids", async () => {
    const res = await on.inject({ method: "POST", url: "/api/demo/sample-case" });
    expect(res.statusCode).toBe(200);
    const { workflowId } = res.json();
    expect(workflowId).toMatch(/^inv-9\d{4}$/);
    expect(erp.cloneException).toHaveBeenCalledWith("INV-20931");
    expect(temporal.start).toHaveBeenCalledWith("resolveInvoiceException", "invoice-exception-resolver", workflowId, {
      invoiceId: workflowId.toUpperCase(),
      exceptionId: workflowId.toUpperCase().replace("INV-", "EX-"),
    });
  });

  it("two sample-case calls get distinct workflow ids", async () => {
    const [a, b] = await Promise.all([on.inject({ method: "POST", url: "/api/demo/sample-case" }), on.inject({ method: "POST", url: "/api/demo/sample-case" })]);
    expect(a.json().workflowId).not.toBe(b.json().workflowId);
  });
});
