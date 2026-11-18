import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ApplicationFailure } from "@temporalio/common";
import type { WorkflowHandle } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Activities } from "../dist/activities.js";
import { getProgress, submitReview } from "../dist/client.js";
import type { ResearchInput, ResearchResult } from "../dist/index.js";

// Runs the real workflow code on Temporal's time-skipping test server, with activities mocked:
// no models, no network. A 7-day review timeout passes in milliseconds.
const workflowsPath = fileURLToPath(new URL("../dist/workflows/index.js", import.meta.url));
const QUESTION = "How did the Apollo program change computing?";
let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});
afterAll(async () => {
  await env?.teardown();
});

function mockActivities(overrides: Partial<Activities> = {}): Activities {
  return {
    planQueries: vi.fn(async () => ["apollo program", "apollo guidance computer"]),
    searchWikipedia: vi.fn(async ({ query }: { query: string }) =>
      // Both queries return "Apollo program": it must be picked only once.
      ["Apollo program", `${query} history`].map((title) => ({ title, url: `https://en.wikipedia.org/wiki/${title}`, snippet: "" })),
    ),
    readArticle: vi.fn(async ({ title }: { title: string }) => ({ title, url: `https://en.wikipedia.org/wiki/${title}`, text: `About ${title}.` })),
    writeDraft: vi.fn(async ({ revision }) => ({
      summary: revision ? `Revised: ${revision.feedback} [1]` : "First draft [1][2]",
      keyPoints: ["A point [1]"],
      citedSources: [1, 2],
    })),
    ...overrides,
  } as Activities;
}

async function run(
  input: ResearchInput,
  activities: Activities,
  during?: (handle: WorkflowHandle) => Promise<void>,
): Promise<ResearchResult> {
  const taskQueue = `test-${randomUUID()}`;
  const worker = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowsPath, activities });
  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start("researchAndSummarize", {
      taskQueue,
      workflowId: randomUUID(),
      args: [input],
    });
    if (during) await during(handle);
    return (await handle.result()) as ResearchResult;
  });
}

async function waitForReview(handle: WorkflowHandle, draftVersion: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const p = await getProgress(handle);
    if (p.stage === "awaiting_review" && p.draftVersion === draftVersion) return;
    await sleep(50);
  }
  throw new Error(`draft ${draftVersion} never reached review`);
}

describe("researchAndSummarize", () => {
  it("returns the first draft when approval isn't required", async () => {
    const activities = mockActivities();
    const result = await run({ question: QUESTION, requireApproval: false }, activities);

    expect(result.status).toBe("auto_approved");
    expect(result.summary).toBe("First draft [1][2]");
    // Two queries x two hits, with "Apollo program" shared: three distinct articles.
    expect(result.sources.map((s) => s.title)).toEqual(["Apollo program", "apollo program history", "apollo guidance computer history"]);
    expect(result.sources.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("waits for a reviewer and returns the approved draft", async () => {
    const result = await run({ question: QUESTION }, mockActivities(), async (handle) => {
      await waitForReview(handle, 1);
      const ack = await submitReview(handle, { approved: true, reviewer: "jordan" });
      expect(ack).toEqual({ accepted: true, draftVersion: 1 });
    });

    expect(result.status).toBe("approved");
    expect(result.reviewer).toBe("jordan");
    expect(result.draftVersion).toBe(1);
  });

  it("revises the draft with reviewer feedback", async () => {
    const activities = mockActivities();
    const result = await run({ question: QUESTION }, activities, async (handle) => {
      await waitForReview(handle, 1);
      await submitReview(handle, { approved: false, feedback: "add dates" });
      await waitForReview(handle, 2);
      expect((await getProgress(handle)).draft?.summary).toBe("Revised: add dates [1]");
      await submitReview(handle, { approved: true });
    });

    expect(result.status).toBe("approved");
    expect(result.draftVersion).toBe(2);
    expect(activities.writeDraft).toHaveBeenCalledTimes(2);
  });

  it("refuses a rejection without feedback, leaving the run waiting", async () => {
    const result = await run({ question: QUESTION }, mockActivities(), async (handle) => {
      await waitForReview(handle, 1);
      await expect(submitReview(handle, { approved: false })).rejects.toThrow();
      await submitReview(handle, { approved: true });
    });
    expect(result.status).toBe("approved");
  });

  it("ends as rejected after the maximum number of revisions", async () => {
    const result = await run({ question: QUESTION }, mockActivities(), async (handle) => {
      for (const version of [1, 2, 3]) {
        await waitForReview(handle, version);
        await submitReview(handle, { approved: false, feedback: `try again (${version})` });
      }
    });
    expect(result.status).toBe("rejected");
    expect(result.draftVersion).toBe(3);
    expect(result.reason).toBe("try again (3)");
  });

  it("expires when nobody reviews within the timeout", async () => {
    // No reviewer: the time-skipping server jumps over the 7-day timeout.
    const result = await run({ question: QUESTION }, mockActivities());
    expect(result.status).toBe("expired");
    expect(result.summary).toBe("First draft [1][2]");
  });

  it("ends as blocked, without retrying, when the guardrail rejects a source", async () => {
    const writeDraft = vi.fn(async () => {
      throw ApplicationFailure.nonRetryable("blocked by the prompt-injection guardrail: hidden instructions", "GuardrailBlocked");
    });
    const result = await run({ question: QUESTION }, mockActivities({ writeDraft } as Partial<Activities>));

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("hidden instructions");
    expect(writeDraft).toHaveBeenCalledTimes(1);
  });

  it("ends as no_sources when nothing can be read", async () => {
    const readArticle = vi.fn(async () => undefined);
    const result = await run({ question: QUESTION }, mockActivities({ readArticle } as Partial<Activities>));
    expect(result.status).toBe("no_sources");
  });

  it("rejects an invalid question before doing any work", async () => {
    const activities = mockActivities();
    const error = await run({ question: "hi" }, activities).catch((e: Error & { cause?: Error }) => e);
    expect((error as Error & { cause?: Error }).cause?.message).toContain("question: ask a full question");
    expect(activities.planQueries).not.toHaveBeenCalled();
  });
});
