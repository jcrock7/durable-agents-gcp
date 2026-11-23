// Each agent's words for the shared components (docs/design/agent-portal/agent-screen-guidelines.md).
// The agent registry in the API declares them; anything an agent leaves out falls back to the neutral word.
// Screens that list several agents call vocab() with no agent, so they always get the neutral words.

export interface Vocabulary {
  case: string;
  cases: string;
  sources: string;
  source: string;
  citePrefix: string;
  figures: string;
  ruleStops: string;
  proposal: string;
  approve: string;
  ruleName: string;
  specialist: string;
  counterparty: string;
  searchHint: string;
  sendBackHint: string;
  escalateHint: string;
}

export interface Layout {
  case: { main: string[]; margin: string[] };
}

export const NEUTRAL: Vocabulary = {
  case: "Case",
  cases: "Cases",
  sources: "Sources",
  source: "Source",
  citePrefix: "S",
  figures: "Figures",
  ruleStops: "Rule Stops",
  proposal: "Proposal",
  approve: "Approve",
  ruleName: "a rule",
  specialist: "Specialist",
  counterparty: "Other Party",
  searchHint: "Search by case",
  sendBackHint: "Tell the agent what to do instead",
  escalateHint: "What the specialist should check",
};

export function vocab(agent?: { vocabulary?: Partial<Vocabulary> }): Vocabulary {
  return { ...NEUTRAL, ...agent?.vocabulary };
}
