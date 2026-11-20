import { useState, type ReactNode } from "react";

export interface Step {
  title: string;
  /** One line under the title. */
  result: string;
  /** Clock time for the first step, elapsed for the rest, "Now" for the current one. */
  time: string;
  now?: boolean;
  /** Three labelled cells shown when the step is selected. */
  detail: Array<{ label: string; body: ReactNode }>;
}

/** The agent's work as one line of steps; selecting a step shows what it did. Used by every agent's case page. */
export function StepStrip({ steps }: { steps: Step[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  if (steps.length === 0) return null;
  const sel = Math.min(picked ?? steps.length - 1, steps.length - 1);
  const selected = steps[sel]!;
  return (
    <div className="steps-wrap">
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={i}>
            <button type="button" className={`step${s.now ? " now" : ""}${i === sel ? " sel" : ""}`} aria-pressed={i === sel} onClick={() => setPicked(i)}>
              <span className="n">
                <i>{s.now ? i + 1 : "✓"}</i>
                {s.time}
              </span>
              <b>{s.title}</b>
              <span className="r">{s.result}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="panel sdw" aria-live="polite">
        <div className="row hd">
          <b>
            Step {sel + 1} · {selected.title}
          </b>
          <span>Select any step above to see what the agent did</span>
        </div>
        <div className="sd">
          {selected.detail.map((d) => (
            <div key={d.label}>
              <span className="lab">{d.label}</span>
              {d.body}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

/** "18:39:52" for the first step, "+9s" for later ones, "Now" for the current one. */
export function stepTime(timeline: Array<{ at: string; state?: string }>, i: number): string {
  const t = timeline[i]!;
  if (t.state === "now") return "Now";
  if (i === 0) return clock(t.at);
  const s = Math.round((Date.parse(t.at) - Date.parse(timeline[0]!.at)) / 1000);
  return s < 120 ? `+${s}s` : s < 7200 ? `+${Math.round(s / 60)}m` : `+${Math.round(s / 3600)}h`;
}

export { clock };
