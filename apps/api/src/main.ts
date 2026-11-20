// The portal API process: JSON under /api, the built web UI everywhere else (ADR-0013).
//   TEMPORAL_ADDRESS   default temporal:7233
//   LITELLM_BASE_URL   default http://litellm:4000
//   LITELLM_VIEWER_KEY a LiteLLM key with the proxy_admin_viewer role: reads spend, can't spend
//   POD_NAMESPACE      for the Kubernetes API (default agents)
//   WEB_DIR            built web UI (default ../web next to dist)
//   SKILLS_DIR         agents' skills, <dir>/<agentId>/<skill>/SKILL.md (default ../skills next to dist)
//   PORTAL_LOCAL_USER  who is signed in when there is no IAP header (local development)
//   PORTAL_MANUAL_COST_PER_CASE_USD  what a case costs to work by hand; unset hides the comparison
//   PORT               default 8080
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { kubernetesSource, litellmSource, temporalSource } from "./sources.js";

const app = buildApp({
  temporal: await temporalSource(process.env.TEMPORAL_ADDRESS ?? "temporal:7233", process.env.TEMPORAL_NAMESPACE ?? "default"),
  litellm: litellmSource(process.env.LITELLM_BASE_URL ?? "http://litellm:4000", process.env.LITELLM_VIEWER_KEY),
  kubernetes: kubernetesSource(process.env.POD_NAMESPACE ?? "agents"),
  webDir: process.env.WEB_DIR ?? fileURLToPath(new URL("../web/", import.meta.url)),
  localUser: process.env.PORTAL_LOCAL_USER,
  skillsDir: process.env.SKILLS_DIR ?? fileURLToPath(new URL("../skills/", import.meta.url)),
  manualCostPerCaseUsd: Number(process.env.PORTAL_MANUAL_COST_PER_CASE_USD) > 0 ? Number(process.env.PORTAL_MANUAL_COST_PER_CASE_USD) : undefined,
});

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void app.close().then(() => process.exit(0)));
