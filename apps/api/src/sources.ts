// The portal's three data sources: Temporal (cases), LiteLLM (spend and health) and the
// Kubernetes API (MCP server replicas and platform health). Each is behind an interface so tests
// can replace it.
import { readFile } from "node:fs/promises";
import { Client, Connection, defaultPayloadConverter, WorkflowNotFoundError } from "@temporalio/client";

export interface RunInfo {
  workflowId: string;
  runId: string;
  type: string;
  status: string;
  startTime: string;
  closeTime?: string;
}

export interface TemporalSource {
  listRuns(query: string, limit: number): Promise<RunInfo[]>;
  count(query: string): Promise<number>;
  query<T>(workflowId: string, name: string): Promise<T | undefined>;
  update<T>(workflowId: string, name: string, arg: unknown): Promise<T>;
  signal(workflowId: string, name: string, arg: unknown): Promise<void>;
  start(type: string, taskQueue: string, workflowId: string, arg: unknown): Promise<void>;
  /** Why and by whom a run was terminated or cancelled, from its last history event. */
  termination?(workflowId: string, runId: string): Promise<{ reason?: string; identity?: string } | undefined>;
  /** The newest run's status and pending activities (Live Run view). Undefined if there is no such workflow. */
  describe?(workflowId: string): Promise<RunDescription | undefined>;
  /** The newest run's full history, as plain objects. */
  history?(workflowId: string): Promise<RawHistoryEvent[]>;
  healthy(): Promise<boolean>;
}

/** One history event as plain data: `type` is PascalCase without the EVENT_TYPE_ prefix, `attrs` its attributes. */
export interface RawHistoryEvent {
  id: number;
  at: string;
  type: string;
  attrs: Record<string, unknown>;
}

export interface PendingActivity {
  activityId: string;
  activityType: string;
  attempt: number;
  state: string;
  scheduledTime?: string;
  lastStartedTime?: string;
  lastWorkerIdentity?: string;
  lastFailure?: { message: string; timeoutType?: string };
  /** The latest heartbeat details, decoded. */
  heartbeat?: unknown;
}

export interface RunDescription {
  runId: string;
  status: string;
  startTime: string;
  closeTime?: string;
  pending: PendingActivity[];
}

export interface KeySpend {
  alias: string;
  spend: number;
  maxBudget: number | null;
  resetsAt: string | null;
}

export interface LiteLLMSource {
  keys(): Promise<KeySpend[]>;
  healthy(): Promise<boolean>;
  /** Which model each gateway alias ("fast", "smart") routes to. Optional: absent sources show the aliases alone. */
  models?(): Promise<Record<string, string>>;
}

export interface DeploymentStatus {
  name: string;
  ready: number;
  replicas: number;
  hpa?: { min: number; max: number; current: number; cpuPercent: number | null };
}

export interface KubernetesSource {
  deployments(names: string[]): Promise<DeploymentStatus[]>;
  postgresReady(): Promise<boolean | null>;
  /** Worker pods (label app.kubernetes.io/name=worker), for the demo kill. */
  workerPods?(): Promise<Array<{ name: string; ready: boolean }>>;
  /** Delete a pod with no grace period: a crash, not a shutdown. Needs the demo-worker-killer Role. */
  deletePod?(name: string): Promise<void>;
}

const PENDING_STATES: Record<number, string> = { 1: "SCHEDULED", 2: "STARTED", 3: "CANCEL_REQUESTED", 4: "PAUSED", 5: "PAUSE_REQUESTED" };
const TIMEOUT_NAMES: Record<number, string> = { 1: "START_TO_CLOSE", 2: "SCHEDULE_TO_START", 3: "SCHEDULE_TO_CLOSE", 4: "HEARTBEAT" };
const timeoutName = (t: unknown) => (t == null ? undefined : TIMEOUT_NAMES[Number(t)]);

/** A protobuf Timestamp as an ISO string. */
function iso(t: { seconds?: unknown; nanos?: number | null } | null | undefined): string | undefined {
  if (!t || t.seconds == null) return undefined;
  return new Date(Number(t.seconds) * 1000 + Math.floor((t.nanos ?? 0) / 1e6)).toISOString();
}

/** Protobuf message → plain JSON-able data: Longs become numbers, byte arrays are dropped. */
function plain(v: unknown): unknown {
  if (v == null) return undefined;
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") return (v as { toNumber(): number }).toNumber();
  if (v instanceof Uint8Array) return undefined;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const p = plain(x);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  return v;
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))]);

export async function temporalSource(address: string, namespace = "default"): Promise<TemporalSource> {
  let client: Client | undefined;
  const get = async () => {
    client ??= new Client({ connection: await Connection.connect({ address }), namespace });
    return client;
  };
  return {
    async listRuns(query, limit) {
      const out: RunInfo[] = [];
      for await (const w of (await get()).workflow.list({ query })) {
        out.push({
          workflowId: w.workflowId,
          runId: w.runId,
          type: w.type,
          status: w.status.name,
          startTime: w.startTime.toISOString(),
          closeTime: w.closeTime?.toISOString(),
        });
        if (out.length >= limit) break;
      }
      return out;
    },
    async count(query) {
      return (await (await get()).workflow.count(query)).count;
    },
    async query(workflowId, name) {
      try {
        return await withTimeout((await get()).workflow.getHandle(workflowId).query(name), 5_000, `query ${name} on ${workflowId}`);
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) return undefined;
        throw error;
      }
    },
    async update(workflowId, name, arg) {
      return (await get()).workflow.getHandle(workflowId).executeUpdate(name, { args: [arg] });
    },
    async signal(workflowId, name, arg) {
      await (await get()).workflow.getHandle(workflowId).signal(name, arg);
    },
    async start(type, taskQueue, workflowId, arg) {
      await (await get()).workflow.start(type, { taskQueue, workflowId, args: [arg] });
    },
    async termination(workflowId, runId) {
      const history = await withTimeout((await get()).workflow.getHandle(workflowId, runId).fetchHistory(), 5_000, `history of ${workflowId}`);
      const last = history.events?.at(-1);
      const t = last?.workflowExecutionTerminatedEventAttributes;
      if (t) return { reason: t.reason || undefined, identity: t.identity || undefined };
      const c = last?.workflowExecutionCanceledEventAttributes;
      return c ? {} : undefined;
    },
    async describe(workflowId) {
      try {
        const d = await withTimeout((await get()).workflow.getHandle(workflowId).describe(), 5_000, `describe ${workflowId}`);
        const pending: PendingActivity[] = (d.raw.pendingActivities ?? []).map((p) => {
          const failure = p.lastFailure ?? undefined;
          const payload = p.heartbeatDetails?.payloads?.[0];
          let heartbeat: unknown;
          try {
            heartbeat = payload ? defaultPayloadConverter.fromPayload(payload) : undefined;
          } catch {
            heartbeat = undefined;
          }
          return {
            activityId: String(p.activityId ?? ""),
            activityType: String(p.activityType?.name ?? ""),
            attempt: Number(p.attempt ?? 1),
            state: PENDING_STATES[Number(p.state ?? 0)] ?? "UNKNOWN",
            scheduledTime: iso(p.scheduledTime),
            lastStartedTime: iso(p.lastStartedTime),
            lastWorkerIdentity: p.lastWorkerIdentity || undefined,
            lastFailure: failure
              ? { message: String(failure.message ?? ""), timeoutType: timeoutName(failure.timeoutFailureInfo?.timeoutType) }
              : undefined,
            heartbeat,
          };
        });
        return { runId: d.runId, status: d.status.name, startTime: d.startTime.toISOString(), closeTime: d.closeTime?.toISOString(), pending };
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) return undefined;
        throw error;
      }
    },
    async history(workflowId) {
      const h = await withTimeout((await get()).workflow.getHandle(workflowId).fetchHistory(), 5_000, `history of ${workflowId}`);
      return (h.events ?? []).map((e) => {
        const key = Object.keys(e).find((k) => k.endsWith("EventAttributes") && (e as Record<string, unknown>)[k]);
        return {
          id: Number(e.eventId ?? 0),
          at: iso(e.eventTime) ?? "",
          type: key ? key[0]!.toUpperCase() + key.slice(1, -"EventAttributes".length) : "Unknown",
          attrs: key ? (plain((e as Record<string, unknown>)[key]) as Record<string, unknown>) : {},
        };
      });
    },
    async healthy() {
      try {
        await withTimeout((await get()).workflow.count("WorkflowType = 'none'"), 3_000, "Temporal");
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** LiteLLM with a viewer-role key: reads key spend and budgets, cannot call models or change keys. */
export function litellmSource(baseUrl: string, viewerKey: string | undefined): LiteLLMSource {
  const call = async (path: string) => {
    const res = await fetch(`${baseUrl}${path}`, { headers: viewerKey ? { authorization: `Bearer ${viewerKey}` } : {}, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`LiteLLM ${path}: HTTP ${res.status}`);
    return res;
  };
  return {
    async keys() {
      if (!viewerKey) return [];
      const body = (await (await call("/key/list?return_full_object=true&size=100")).json()) as {
        keys?: Array<{ key_alias?: string; spend?: number; max_budget?: number | null; budget_reset_at?: string | null }>;
      };
      return (body.keys ?? [])
        .filter((k) => k.key_alias)
        .map((k) => ({ alias: k.key_alias!, spend: k.spend ?? 0, maxBudget: k.max_budget ?? null, resetsAt: k.budget_reset_at ?? null }));
    },
    async models() {
      if (!viewerKey) return {};
      const body = (await (await call("/model/info")).json()) as { data?: Array<{ model_name?: string; litellm_params?: { model?: string } }> };
      const out: Record<string, string> = {};
      for (const m of body.data ?? []) if (m.model_name && m.litellm_params?.model && !out[m.model_name]) out[m.model_name] = m.litellm_params.model;
      return out;
    },
    async healthy() {
      try {
        await call("/health/liveliness");
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * The Kubernetes API from inside the cluster, with the pod's service account (read-only Role on
 * deployments, HPAs and the Postgres cluster in this namespace). NODE_EXTRA_CA_CERTS must point at
 * the service account's ca.crt. Outside a cluster, every call reports "unknown".
 */
export function kubernetesSource(namespace: string): KubernetesSource {
  const base = process.env.KUBERNETES_SERVICE_HOST ? `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT ?? 443}` : undefined;
  const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token";
  const get = async <T>(path: string): Promise<T | undefined> => {
    if (!base) return undefined;
    const token = (await readFile(tokenPath, "utf8")).trim();
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  };
  type Dep = { metadata: { name: string }; status?: { readyReplicas?: number; replicas?: number } };
  type Hpa = {
    metadata: { name: string };
    spec: { minReplicas?: number; maxReplicas: number };
    status: { currentReplicas?: number; currentMetrics?: Array<{ resource?: { current?: { averageUtilization?: number } } }> };
  };
  return {
    async deployments(names) {
      const [deps, hpas] = await Promise.all([
        get<{ items: Dep[] }>(`/apis/apps/v1/namespaces/${namespace}/deployments`),
        get<{ items: Hpa[] }>(`/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers`),
      ]);
      return names.map((name) => {
        const d = deps?.items.find((x) => x.metadata.name === name);
        const h = hpas?.items.find((x) => x.metadata.name === name);
        return {
          name,
          ready: d?.status?.readyReplicas ?? 0,
          replicas: d?.status?.replicas ?? 0,
          ...(h
            ? {
                hpa: {
                  min: h.spec.minReplicas ?? 1,
                  max: h.spec.maxReplicas,
                  current: h.status.currentReplicas ?? 0,
                  cpuPercent: h.status.currentMetrics?.[0]?.resource?.current?.averageUtilization ?? null,
                },
              }
            : {}),
        };
      });
    },
    async workerPods() {
      type Pod = { metadata: { name: string; deletionTimestamp?: string }; status?: { conditions?: Array<{ type: string; status: string }> } };
      const pods = await get<{ items: Pod[] }>(`/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent("app.kubernetes.io/name=worker")}`);
      return (pods?.items ?? [])
        .filter((p) => !p.metadata.deletionTimestamp)
        .map((p) => ({ name: p.metadata.name, ready: p.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True") ?? false }));
    },
    async deletePod(name) {
      if (!base) throw new Error("not running in Kubernetes");
      const token = (await readFile(tokenPath, "utf8")).trim();
      const res = await fetch(`${base}/api/v1/namespaces/${namespace}/pods/${encodeURIComponent(name)}?gracePeriodSeconds=0`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`delete pod ${name}: HTTP ${res.status}`);
    },
    async postgresReady() {
      const c = await get<{ status?: { readyInstances?: number; instances?: number } }>(`/apis/postgresql.cnpg.io/v1/namespaces/${namespace}/clusters/agents-pg`);
      if (!c) return null;
      return (c.status?.readyInstances ?? 0) >= (c.status?.instances ?? 1);
    },
  };
}
