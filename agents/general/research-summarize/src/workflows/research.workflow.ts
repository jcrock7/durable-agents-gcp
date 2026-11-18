import { ApplicationFailure, proxyActivities, setHandler } from "@temporalio/workflow";
import {
  FailureType,
  MODEL_CALL_OPTIONS,
  ReviewGate,
  TOOL_CALL_OPTIONS,
  failureTypeOf,
} from "@agents/agent-kit/workflow";
import type { Activities } from "../activities.js";
import { agentConfig } from "../agent.config.js";
import { PROMPT_VERSION } from "../prompts/index.js";
import { ResearchInputSchema, type Draft, type ResearchInput } from "../schemas.js";
import { selectSources } from "../select.js";
import { progressQuery } from "../signals.js";
import type { Progress, ResearchResult, ResearchStatus, Source } from "../types.js";

// Deterministic orchestration only: every model and tool call is an activity.
const { planQueries, writeDraft } = proxyActivities<Activities>(MODEL_CALL_OPTIONS);
const { searchWikipedia, readArticle } = proxyActivities<Activities>(TOOL_CALL_OPTIONS);

/**
 * Research a question and return a cited summary:
 * plan queries → search → read articles → draft → human review (revise on feedback) → result.
 */
export async function researchAndSummarize(rawInput: ResearchInput): Promise<ResearchResult> {
  // Invalid input must fail the run. Any other error thrown here would be treated as a bug in the
  // workflow code, and Temporal would retry the workflow task until the code is fixed.
  const parsed = ResearchInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    throw ApplicationFailure.nonRetryable(`invalid input: ${problems}`, "InvalidInput");
  }
  const input = parsed.data;
  const { limits } = agentConfig;
  const progress: Progress = { stage: "planning", queries: [], sources: [], draftVersion: 0 };
  setHandler(progressQuery, () => progress);
  const review = new ReviewGate();

  const finish = (status: ResearchStatus, extra: Partial<ResearchResult> = {}): ResearchResult => {
    progress.stage = "done";
    return {
      status,
      question: input.question,
      summary: progress.draft?.summary,
      keyPoints: progress.draft?.keyPoints,
      sources: progress.sources,
      draftVersion: progress.draftVersion,
      promptVersion: PROMPT_VERSION,
      ...extra,
    };
  };

  try {
    // 1. Plan searches.
    progress.queries = await planQueries({ question: input.question });

    // 2. Search, in parallel, and pick distinct articles across queries.
    progress.stage = "searching";
    const results = await Promise.all(progress.queries.map((query) => searchWikipedia({ query })));
    const picked = selectSources(results, input.maxSources);

    // 3. Read the articles, in parallel. An article that can't be read is skipped.
    progress.stage = "reading";
    const read = await Promise.allSettled(picked.map((hit) => readArticle({ title: hit.title })));
    const sources: Source[] = [];
    for (const outcome of read) {
      if (outcome.status === "fulfilled" && outcome.value) {
        sources.push({ id: sources.length + 1, ...outcome.value });
      }
    }
    progress.sources = sources.map(({ id, title, url }) => ({ id, title, url }));
    if (sources.length === 0) {
      return finish("no_sources", { reason: "no readable Wikipedia articles matched the question" });
    }

    // 4. Draft.
    progress.stage = "drafting";
    let draft: Draft = await writeDraft({ question: input.question, sources });
    progress.draft = draft;
    progress.draftVersion = 1;
    if (!input.requireApproval) return finish("auto_approved");

    // 5. Human review: approve, or reject with feedback for another draft.
    for (;;) {
      progress.stage = "awaiting_review";
      const decision = await review.wait(progress.draftVersion, limits.reviewTimeout);
      if (!decision) {
        return finish("expired", { reason: `no review within ${limits.reviewTimeout}` });
      }
      if (decision.approved) return finish("approved", { reviewer: decision.reviewer });

      progress.lastFeedback = decision.feedback;
      if (progress.draftVersion > limits.maxRevisions) {
        return finish("rejected", { reviewer: decision.reviewer, reason: decision.feedback });
      }
      progress.stage = "revising";
      draft = await writeDraft({
        question: input.question,
        sources,
        revision: { draft, feedback: decision.feedback ?? "" },
      });
      progress.draft = draft;
      progress.draftVersion += 1;
    }
  } catch (error) {
    // A guardrail block is an answer, not a crash: end the run with the reason.
    if (failureTypeOf(error) === FailureType.GuardrailBlocked) {
      return finish("blocked", { reason: (error as Error & { cause?: Error }).cause?.message });
    }
    throw error;
  }
}
