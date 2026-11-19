// Load generator for the HPA demo: calls run_match on random seeded invoices from many concurrent
// MCP sessions and prints throughput and latency every 10 seconds. Runs as a Kubernetes Job
// (platform/mcp/match-engine/load-test-job.yaml, started by scripts/local/match-engine-load.sh).
//
// MATCH_ENGINE_URL (default http://mcp-match-engine:8080/mcp), CONCURRENCY (default 24),
// DURATION_SECONDS (default 180), INVOICES (default 988: INV-20000 … INV-20987).
import { connectHttp } from "@agents/agent-kit";

const url = process.env.MATCH_ENGINE_URL ?? "http://mcp-match-engine:8080/mcp";
const concurrency = Number(process.env.CONCURRENCY ?? 24);
const durationMs = Number(process.env.DURATION_SECONDS ?? 180) * 1000;
const invoices = Number(process.env.INVOICES ?? 988);

const latencies: number[] = [];
let ok = 0;
let errors = 0;
let lastError = "";
const started = Date.now();
const deadline = started + durationMs;

async function worker(n: number): Promise<void> {
  // A fresh session per worker; Service load-balancing spreads new connections across replicas.
  let conn = await connectHttp("match-engine", url);
  let calls = 0;
  while (Date.now() < deadline) {
    const id = `INV-${20000 + Math.floor(Math.random() * invoices)}`;
    const t0 = performance.now();
    try {
      const result = await conn.callTool("run_match", { invoice_id: id });
      if (result.isError) throw new Error(result.content.map((c) => c.text).join(" "));
      ok++;
      latencies.push(performance.now() - t0);
    } catch (error) {
      errors++;
      lastError = `${id}: ${error instanceof Error ? error.message : String(error)}`;
    }
    // Reconnect now and then so new replicas get traffic as the HPA adds them.
    if (++calls % 50 === 0) {
      await conn.close().catch(() => undefined);
      conn = await connectHttp("match-engine", url);
    }
  }
  await conn.close().catch(() => undefined);
  void n;
}

function report(final = false): void {
  const sorted = latencies.splice(0).sort((a, b) => a - b);
  const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!.toFixed(0) : "-");
  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(
    JSON.stringify({ t: `${elapsed}s`, calls: sorted.length, rps: +(sorted.length / 10).toFixed(1), p50ms: pct(50), p95ms: pct(95), okTotal: ok, errorsTotal: errors, ...(final && lastError ? { lastError } : {}) }),
  );
}

console.log(JSON.stringify({ msg: "load test", url, concurrency, durationSeconds: durationMs / 1000 }));
const timer = setInterval(() => report(), 10_000);
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
clearInterval(timer);
report(true);
process.exit(errors > ok / 10 ? 1 : 0);
