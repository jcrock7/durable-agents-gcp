// Everything that defines this agent's behavior and limits, in one place.
// Imported by workflow code, so it must stay plain data.
export const agentConfig = {
  name: "research-summarize",
  taskQueue: "research-summarize",
  workflowType: "researchAndSummarize",

  /** Environment variable with this agent's LiteLLM virtual key (from Secret litellm-agent-keys). */
  apiKeyEnv: "LITELLM_KEY_RESEARCH_SUMMARIZE",

  /** LiteLLM aliases per step: a cheap model to plan, a stronger one to write. */
  models: { plan: "fast", draft: "smart" },

  /** Tool allow-list: the only hosts the tools may call. */
  allowedHosts: ["en.wikipedia.org"],

  limits: {
    maxQueries: 3,
    resultsPerQuery: 4,
    defaultSources: 5,
    maxSources: 8,
    /** Characters of each article given to the model. */
    maxSourceChars: 6000,
    /** Redrafts after reviewer feedback before the run ends as rejected. */
    maxRevisions: 2,
    /** How long a draft waits for review before the run ends as expired. */
    reviewTimeout: "7 days",
  },
} as const;
