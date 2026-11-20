// promptfoo assertion: a case passes when every check that applies to it passes.
import { scoreCase } from "./score.mjs";

export default function (output, context) {
  let o;
  try {
    o = JSON.parse(output);
  } catch {
    return { pass: false, score: 0, reason: `not a case summary: ${String(output).slice(0, 200)}` };
  }
  const checks = scoreCase(o, context.vars);
  const failed = checks.filter(([, ok]) => !ok);
  return {
    pass: failed.length === 0,
    score: (checks.length - failed.length) / checks.length,
    reason: checks.map(([name, ok, why]) => `${ok ? "ok" : "FAIL"} ${name}: ${why}`).join("; "),
  };
}
