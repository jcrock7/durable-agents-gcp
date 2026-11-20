// One promptfoo test per labelled exception, straight from the seeded generator (the same data the
// ERP was loaded with). EVAL_SCENARIOS=a,b limits to some scenarios; EVAL_PER_SCENARIO=n to the
// first n of each; EVAL_LIMIT=n to the first n.
import { generateErp } from "../dist/data/index.js";

export default function tests() {
  let labels = generateErp().labels;
  if (process.env.EVAL_SCENARIOS) {
    const wanted = new Set(process.env.EVAL_SCENARIOS.split(","));
    labels = labels.filter((l) => wanted.has(l.scenario));
  }
  if (process.env.EVAL_PER_SCENARIO) {
    const per = Number(process.env.EVAL_PER_SCENARIO);
    const seen = new Map();
    labels = labels.filter((l) => {
      seen.set(l.scenario, (seen.get(l.scenario) ?? 0) + 1);
      return seen.get(l.scenario) <= per;
    });
  }
  if (process.env.EVAL_LIMIT) labels = labels.slice(0, Number(process.env.EVAL_LIMIT));
  return labels.map((l) => ({
    description: `${l.scenario} ${l.invoiceId}`,
    vars: {
      invoiceId: l.invoiceId,
      exceptionId: l.exceptionId,
      scenario: l.scenario,
      expectedType: l.expectedType,
      expectedAction: l.expectedAction,
      needsPerson: l.needsPerson,
      fraudFlag: l.fraudFlag,
    },
  }));
}
