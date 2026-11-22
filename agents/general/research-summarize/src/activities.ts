import { log } from "@temporalio/activity";
import { gatewayCostUsd, MODEL_CALL, toActivityFailure, withHeartbeat, type ModelAlias } from "@agents/agent-kit";
import { generateText, Output, type LanguageModel } from "ai";
import { agentConfig } from "./agent.config.js";
import { DRAFT_SYSTEM, PLAN_SYSTEM, draftPrompt, planPrompt } from "./prompts/index.js";
import { DraftSchema, QueryPlanSchema, type Draft } from "./schemas.js";
import { readWikipediaArticle, searchWikipedia, type Fetch } from "./tools/wikipedia.js";
import type { SearchHit, Source, Usage } from "./types.js";

export interface ActivityDeps {
  models: Record<ModelAlias, LanguageModel>;
  fetch?: Fetch;
}

/**
 * Every side effect of the agent: model calls and tool calls. Each runs as a Temporal activity,
 * so a failure is retried by policy and a completed step is never repeated after a crash.
 */
const usageOf = (step: string, model: string, u: { inputTokens?: number; outputTokens?: number }, costUsd: number): Usage => ({
  step,
  model,
  inputTokens: u.inputTokens ?? 0,
  outputTokens: u.outputTokens ?? 0,
  costUsd,
});

export function createActivities({ models, fetch: fetchImpl = fetch }: ActivityDeps) {
  const { limits } = agentConfig;

  return {
    /** fast model: turn the question into Wikipedia search queries. */
    async planQueries(input: { question: string }): Promise<{ queries: string[]; usage: Usage }> {
      try {
        const { output, usage, response } = await withHeartbeat((abortSignal) =>
          generateText({
            ...MODEL_CALL,
            abortSignal,
            model: models[agentConfig.models.plan],
            system: PLAN_SYSTEM.replace("{maxQueries}", String(limits.maxQueries)),
            prompt: planPrompt(input.question),
            output: Output.object({ schema: QueryPlanSchema }),
          }),
        );
        const queries = [...new Set(output.queries.map((q) => q.trim()).filter(Boolean))];
        return { queries: queries.slice(0, limits.maxQueries), usage: usageOf("plan searches", agentConfig.models.plan, usage, gatewayCostUsd(response.headers)) };
      } catch (error) {
        throw toActivityFailure(error);
      }
    },

    /** Tool: Wikipedia full-text search. */
    async searchWikipedia(input: { query: string }): Promise<SearchHit[]> {
      return searchWikipedia(input.query, limits.resultsPerQuery, fetchImpl);
    },

    /** Tool: read one article as plain text. Undefined if it no longer exists. */
    async readArticle(input: { title: string }): Promise<Omit<Source, "id"> | undefined> {
      return readWikipediaArticle(input.title, limits.maxSourceChars, fetchImpl);
    },

    /** smart model: write (or revise) the cited answer from the sources. */
    async writeDraft(input: {
      question: string;
      sources: Source[];
      revision?: { draft: Draft; feedback: string };
    }): Promise<Draft & { usage: Usage }> {
      try {
        const { output, usage, response } = await withHeartbeat((abortSignal) =>
          generateText({
            ...MODEL_CALL,
            abortSignal,
            model: models[agentConfig.models.draft],
            system: DRAFT_SYSTEM,
            prompt: draftPrompt(input.question, input.sources, input.revision),
            output: Output.object({ schema: DraftSchema }),
          }),
        );
        // Keep only citations that point at a real source.
        const valid = new Set(input.sources.map((s) => s.id));
        const citedSources = [...new Set(output.citedSources)].filter((id) => valid.has(id)).sort((a, b) => a - b);
        log.info("draft written", { revision: Boolean(input.revision), cited: citedSources.length });
        const unrelatedSources = [...new Set(output.unrelatedSources ?? [])].filter((id) => valid.has(id) && !citedSources.includes(id)).sort((a, b) => a - b);
        return { ...output, citedSources, unrelatedSources, usage: usageOf(input.revision ? "revise draft" : "draft", agentConfig.models.draft, usage, gatewayCostUsd(response.headers)) };
      } catch (error) {
        throw toActivityFailure(error);
      }
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
