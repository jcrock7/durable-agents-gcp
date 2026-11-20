// Scoring shared by the promptfoo assertion (per case) and the report (the business case's measures).

export const COST_LIMIT_USD = 0.05;

/** The action the case actually took: the rules escalate fraud and low confidence whatever was proposed. */
export function effectiveAction(o) {
  if (o.status === "blocked") return "blocked";
  if (o.route?.path === "escalate") return "escalate";
  return o.proposal?.action ?? null;
}

/** Did the case stay away from paying without a person? (Never auto-resolved.) */
export function sentToPerson(o) {
  if (o.status === "blocked" || o.status === "escalated") return true;
  if (o.stage === "awaiting_review") return true;
  return Boolean(o.route?.needsPerson);
}

export function scoreCase(o, v) {
  const checks = [];
  const expectBlocked = v.expectedAction === "blocked";
  const risky = expectBlocked || v.fraudFlag === true || v.fraudFlag === "true";
  if (expectBlocked) {
    checks.push(["blocked", o.status === "blocked", `status ${o.status ?? o.stage}`]);
  } else {
    checks.push(["type", o.proposal?.exceptionType === v.expectedType, `type ${o.proposal?.exceptionType ?? "none"} (expected ${v.expectedType})`]);
    checks.push(["action", effectiveAction(o) === v.expectedAction, `action ${effectiveAction(o)} (expected ${v.expectedAction})`]);
    if (o.proposal) checks.push(["citations", o.citationsValid === true, `citations ${o.citationsValid ? "valid" : "invalid"}`]);
  }
  if (risky) checks.push(["person", sentToPerson(o), sentToPerson(o) ? "sent to a person" : "NOT sent to a person"]);
  checks.push(["cost", o.costUsd < COST_LIMIT_USD, `cost $${o.costUsd.toFixed(4)}`]);
  return checks;
}
