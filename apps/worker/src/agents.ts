import type { AgentRegistration } from "@agents/agent-kit";
import { researchSummarizeAgent } from "@agents/research-summarize";

/** Every agent this worker runs. To add one: add its package as a dependency and list it here. */
export const agents: AgentRegistration[] = [researchSummarizeAgent];
