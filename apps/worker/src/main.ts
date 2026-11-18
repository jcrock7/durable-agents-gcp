// The worker process: one Temporal Worker per agent, each polling the agent's own task queue.
// Workflow state lives in Temporal, so this process holds nothing that can be lost: kill it at any
// point and another worker picks up where it stopped.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { NativeConnection, Worker } from "@temporalio/worker";
import { agents } from "./agents.js";

const address = process.env.TEMPORAL_ADDRESS ?? "temporal:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
const bundleDir = process.env.WORKFLOW_BUNDLE_DIR;
const healthPort = Number(process.env.HEALTH_PORT ?? 8080);

// Retry the first connection: a new pod can briefly fail to reach Temporal (it may be restarting,
// or network policy may not cover the pod's new IP for its first second). Give up after ~2 minutes
// and let Kubernetes restart the pod.
async function connect(): Promise<NativeConnection> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await NativeConnection.connect({ address });
    } catch (error) {
      if (attempt >= 8) throw error;
      const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 30_000);
      console.warn(`cannot reach Temporal at ${address} (attempt ${attempt}): ${(error as Error).message}; retrying in ${delayMs / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const connection = await connect();

const workers = await Promise.all(
  agents.map((agent) => {
    // Prefer the bundle built into the image; fall back to bundling at start (local development).
    const bundlePath = bundleDir ? `${bundleDir}/${agent.name}.js` : undefined;
    const workflowCode =
      bundlePath && existsSync(bundlePath) ? { workflowBundle: { codePath: bundlePath } } : { workflowsPath: agent.workflowsPath };
    return Worker.create({
      connection,
      namespace,
      taskQueue: agent.taskQueue,
      activities: agent.createActivities(),
      identity: `${hostname()}/${agent.name}`,
      // On SIGTERM (pod deletion, Spot preemption) stop polling and give running activities time
      // to finish. Anything still running is retried on another worker.
      shutdownGraceTime: "20 seconds",
      ...workflowCode,
    });
  }),
);

// Kubernetes probes: healthy while every agent's worker is running.
const server = createServer((req, res) => {
  const states = Object.fromEntries(workers.map((w, i) => [agents[i]!.name, w.getState()]));
  const healthy = Object.values(states).every((state) => state === "RUNNING");
  res.writeHead(req.url === "/healthz" ? (healthy ? 200 : 503) : 404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ healthy, workers: states }));
});
server.listen(healthPort);

console.log(`worker started: ${agents.map((a) => `${a.name} on queue "${a.taskQueue}"`).join(", ")}; Temporal at ${address}`);

try {
  // Each run() resolves after a graceful shutdown (the SDK handles SIGINT and SIGTERM).
  await Promise.all(workers.map((worker) => worker.run()));
} finally {
  server.close();
  await connection.close();
  console.log("worker stopped");
}
