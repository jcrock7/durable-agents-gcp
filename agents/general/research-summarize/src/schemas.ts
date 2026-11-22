import { z } from "zod";
import { agentConfig } from "./agent.config.js";

const { limits } = agentConfig;

/** Workflow input. */
export const ResearchInputSchema = z.object({
  question: z.string().trim().min(10, "ask a full question").max(500),
  maxSources: z.number().int().min(1).max(limits.maxSources).default(limits.defaultSources),
  /** false: return the first draft without waiting for a human. */
  requireApproval: z.boolean().default(true),
});
export type ResearchInput = z.input<typeof ResearchInputSchema>;
export type ResearchRequest = z.output<typeof ResearchInputSchema>;

/** Model output: search queries for the question. */
export const QueryPlanSchema = z.object({
  queries: z
    .array(z.string().describe("A short Wikipedia search query, 2-6 words"))
    .min(1)
    .max(limits.maxQueries),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

/** Model output: the draft answer. */
export const DraftSchema = z.object({
  summary: z.string().describe("Markdown answer of 150-300 words citing sources inline as [n]"),
  keyPoints: z.array(z.string()).min(1).max(6).describe("The main findings, one sentence each, with [n] citations"),
  citedSources: z.array(z.number().int()).describe("Numbers of the sources cited"),
  unrelatedSources: z.array(z.number().int()).default([]).describe("Numbers of the sources that do not bear on the question"),
});
export type Draft = z.infer<typeof DraftSchema>;
