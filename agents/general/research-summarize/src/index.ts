import { fileURLToPath } from "node:url";
import { createModels, requireEnv, type AgentRegistration } from "@agents/agent-kit";
import { createActivities } from "./activities.js";
import { agentConfig } from "./agent.config.js";

export { agentConfig } from "./agent.config.js";
export type { ResearchInput } from "./schemas.js";
export type { Progress, ResearchResult, ResearchStatus } from "./types.js";

/** Registered by apps/worker: everything it needs to run this agent. */
export const researchSummarizeAgent: AgentRegistration = {
  name: agentConfig.name,
  taskQueue: agentConfig.taskQueue,
  workflowsPath: fileURLToPath(new URL("./workflows/index.js", import.meta.url)),
  createActivities: () => createActivities({ models: createModels({ apiKey: requireEnv(agentConfig.apiKeyEnv) }) }),
};
