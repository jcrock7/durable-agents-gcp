import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../dist/app.js";
import { podFromIdentity, type ErpDemoSource } from "../dist/demo.js";
import type { KubernetesSource, LiteLLMSource, PendingActivity, RunDescription, RunInfo, TemporalSource } from "../dist/sources.js";

// The worker's real identity format (apps/worker/src/main.ts): <hostname>/<agent>.
const ID_A = "worker-6d5f8-a21c/invoice-exception-resolver";
let pending: PendingActivity[] = [];
let running: RunInfo[] = [];
let pods = [
  { name: "worker-6d5f8-7d9f", ready: true },
  { name: "worker-6d5f8-a21c", ready: true },
];
const temporal: TemporalSource = {
  listRuns: vi.fn(async () => running),
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
  workerPods: vi.fn(async () => pods),
  deletePod: vi.fn(async (name: string) => {
    pods = pods.filter((p) => p.name !== name);
  }),
};
const erp: ErpDemoSource = { resetException: vi.fn(async (invoiceId: string) => ({ invoiceId, exceptionId: "EX-3000" })) };

const on = buildApp({ temporal, litellm, kubernetes, demo: { erp } });
const off = buildApp({ temporal, litellm, kubernetes });
beforeAll(async () => Promise.all([on.ready(), off.ready()]));
afterAll(async () => Promise.all([on.close(), off.close()]));
beforeEach(() => {
  vi.mocked(kubernetes.deletePod!).mockClear();
  vi.mocked(temporal.start).mockClear();
  pods = [
    { name: "worker-6d5f8-7d9f", ready: true },
    { name: "worker-6d5f8-a21c", ready: true },
  ];
  running = [];
});

const kill = () => on.inject({ method: "POST", url: "/api/demo/kill-worker", payload: { workflowId: "inv-20931" } });

describe("demo controls", () => {
  it("demo routes 404 when demo controls are off", async () => {
    expect((await off.inject({ method: "POST", url: "/api/demo/sample-case" })).statusCode).toBe(404);
    expect((await off.inject({ method: "POST", url: "/api/demo/kill-worker", payload: { workflowId: "inv-1" } })).statusCode).toBe(404);
    expect((await off.inject("/api/me")).json().demoControls).toBe(false);
    expect((await on.inject("/api/me")).json().demoControls).toBe(true);
  });

  it("podFromIdentity reads the pod name from the worker identity", () => {
    expect(podFromIdentity(ID_A)).toBe("worker-6d5f8-a21c");
    expect(podFromIdentity("1234@worker-x")).toBe("worker-x");
    expect(podFromIdentity(undefined)).toBeUndefined();
  });

  it("kill-worker deletes the pod named in the pending model activity's identity", async () => {
    pending = [{ activityId: "6", activityType: "gatherEvidence", attempt: 1, state: "STARTED", lastWorkerIdentity: ID_A }];
    const res = await kill();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pod: "worker-6d5f8-a21c" });
    expect(kubernetes.deletePod).toHaveBeenCalledWith("worker-6d5f8-a21c");
  });

  it("a second kill-worker press returns 409 and leaves the surviving worker alone", async () => {
    pending = [{ activityId: "6", activityType: "gatherEvidence", attempt: 1, state: "STARTED", lastWorkerIdentity: ID_A }];
    expect((await kill()).statusCode).toBe(200);
    const again = await kill(); // the activity still shows the dead pod until the heartbeat timeout
    expect(again.statusCode).toBe(409);
    pending = [{ activityId: "6", activityType: "gatherEvidence", attempt: 2, state: "SCHEDULED", lastWorkerIdentity: ID_A }];
    expect((await kill()).statusCode).toBe(409);
    expect(kubernetes.deletePod).toHaveBeenCalledTimes(1);
    expect(pods.map((p) => p.name)).toEqual(["worker-6d5f8-7d9f"]);
  });

  it("kill-worker returns 409 when no model activity is pending", async () => {
    pending = [{ activityId: "7", activityType: "postResolution", attempt: 1, state: "STARTED", lastWorkerIdentity: ID_A }];
    const res = await kill();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no model activity running" });
    pending = [];
    expect((await kill()).statusCode).toBe(409);
    expect(kubernetes.deletePod).not.toHaveBeenCalled();
  });

  it("sample-case resets the demo invoice and starts a case with a fresh workflow id", async () => {
    const res = await on.inject({ method: "POST", url: "/api/demo/sample-case" });
    expect(res.statusCode).toBe(200);
    const { workflowId } = res.json();
    expect(workflowId).toMatch(/^inv-20931-demo-[a-z0-9]+$/);
    expect(erp.resetException).toHaveBeenCalledWith("INV-20931");
    expect(temporal.start).toHaveBeenCalledWith("resolveInvoiceException", "invoice-exception-resolver", workflowId, { invoiceId: "INV-20931", exceptionId: "EX-3000" });
  });

  it("a sample-case press while one is running opens the running case instead of starting another", async () => {
    running = [{ workflowId: "inv-20931-demo-abc", runId: "r", type: "resolveInvoiceException", status: "RUNNING", startTime: "2026-11-20T00:00:00Z" }];
    vi.mocked(erp.resetException).mockClear();
    const res = await on.inject({ method: "POST", url: "/api/demo/sample-case" });
    expect(res.json()).toEqual({ workflowId: "inv-20931-demo-abc" });
    expect(erp.resetException).not.toHaveBeenCalled();
    expect(temporal.start).not.toHaveBeenCalled();
  });
});
