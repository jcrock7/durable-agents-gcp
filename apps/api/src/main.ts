// The portal API process: JSON under /api, the built web UI everywhere else (ADR-0013).
//   TEMPORAL_ADDRESS   default temporal:7233
//   LITELLM_BASE_URL   default http://litellm:4000
//   LITELLM_VIEWER_KEY a LiteLLM key with the proxy_admin_viewer role: reads spend, can't spend
//   POD_NAMESPACE      for the Kubernetes API (default agents)
//   WEB_DIR            built web UI (default ../web next to dist)
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
});

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void app.close().then(() => process.exit(0)));
