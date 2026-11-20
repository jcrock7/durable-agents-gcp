import { condition, defineUpdate, setHandler } from "@temporalio/workflow";
import type { Duration } from "@temporalio/common";

/** A reviewer's decision on the current draft. */
export interface ReviewDecision {
  approved: boolean;
  /** Required when rejecting: what to change. */
  feedback?: string;
  reviewer?: string;
  /** Hand the case to a person instead of approving or sending it back. Only for workflows that opt in. */
  escalate?: { note: string };
}

export interface ReviewGateOptions {
  /** Accept decisions that escalate the case to a person. */
  allowEscalate?: boolean;
}

export interface ReviewAck {
  accepted: true;
  /** Which draft the decision applies to (1 = first draft). */
  draftVersion: number;
}

/**
 * The "review" update. An update (rather than a signal) gives the caller an answer: it is
 * rejected with a reason if the workflow isn't waiting for review, or the decision is incomplete.
 */
export const reviewUpdate = defineUpdate<ReviewAck, [ReviewDecision]>("review");

/**
 * Human-in-the-loop approval for a workflow. Create one at the start of the workflow, then
 * `await gate.wait(draftVersion, timeout)` whenever a human must decide. The wait costs nothing
 * while it lasts: the workflow can be paused for days and survives worker restarts.
 */
export class ReviewGate {
  private open = false;
  private draftVersion = 0;
  private decision: ReviewDecision | undefined;

  constructor(options: ReviewGateOptions = {}) {
    setHandler(
      reviewUpdate,
      (decision) => {
        this.decision = decision;
        return { accepted: true, draftVersion: this.draftVersion };
      },
      {
        validator: (decision) => {
          if (!this.open) throw new Error("not waiting for review");
          if (decision?.escalate) {
            if (!options.allowEscalate) throw new Error("this case cannot be escalated");
            if (!decision.escalate.note?.trim()) throw new Error("a note is required when escalating");
            return;
          }
          if (typeof decision?.approved !== "boolean") throw new Error("'approved' must be true or false");
          if (!decision.approved && !decision.feedback?.trim()) {
            throw new Error("'feedback' is required when rejecting a draft");
          }
        },
      },
    );
  }

  /** Wait for a decision on draft `draftVersion`. Returns undefined if the timeout passes first. */
  async wait(draftVersion: number, timeout: Duration): Promise<ReviewDecision | undefined> {
    this.draftVersion = draftVersion;
    this.decision = undefined;
    this.open = true;
    try {
      const decided = await condition(() => this.decision !== undefined, timeout);
      return decided ? this.decision : undefined;
    } finally {
      this.open = false;
    }
  }
}
