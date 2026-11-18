// Build step: bundle each agent's workflow code once, at image build time, so the worker starts in
// seconds instead of running webpack on every start. Output: dist/bundles/<agent>.js
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundleWorkflowCode } from "@temporalio/worker";
import { agents } from "./agents.js";

const outDir = fileURLToPath(new URL("./bundles/", import.meta.url));
await mkdir(outDir, { recursive: true });

for (const agent of agents) {
  const { code } = await bundleWorkflowCode({ workflowsPath: agent.workflowsPath });
  await writeFile(`${outDir}${agent.name}.js`, code);
  console.log(`bundled ${agent.name} workflows (${Math.round(code.length / 1024)} KiB)`);
}
