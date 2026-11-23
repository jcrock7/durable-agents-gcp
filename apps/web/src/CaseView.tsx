import { useEffect } from "react";
import type { CaseProps } from "./CaseParts.js";
import { DOMAIN } from "./domain/index.js";

/**
 * The case page. Each agent's case sheet is its domain layer (its words and layout, built from shared parts);
 * an agent without one gets the shared fallback message.
 */

export function CaseView(props: CaseProps & { onRef?: (workflowId: string, ref: string) => void }) {
  const { detail, onRef } = props;
  const { workflowId } = detail.summary;
  const ref = detail.summary.ref || workflowId;
  useEffect(() => onRef?.(workflowId, ref), [workflowId, ref, onRef]);
  const Sheet = DOMAIN[detail.agentId]?.Case;
  if (!detail.state || !Sheet) {
    return (
      <main className="page">
        <div className="sheet">
          <p className="empty">{detail.summary.reason ?? (Sheet ? "This run has no state to show (it may have failed to start)." : "This agent has no case page yet.")}</p>
        </div>
      </main>
    );
  }
  return <Sheet {...props} />;
}
