// The portal's three data sources: Temporal (cases), LiteLLM (spend and health) and the
// Kubernetes API (MCP server replicas and platform health). Each is behind an interface so tests
// can replace it.
import { readFile } from "node:fs/promises";
import { Client, Connection, WorkflowNotFoundError } from "@temporalio/client";

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
  healthy(): Promise<boolean>;
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
    async postgresReady() {
      const c = await get<{ status?: { readyInstances?: number; instances?: number } }>(`/apis/postgresql.cnpg.io/v1/namespaces/${namespace}/clusters/agents-pg`);
      if (!c) return null;
      return (c.status?.readyInstances ?? 0) >= (c.status?.instances ?? 1);
    },
  };
}
