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

/** A chapter of a finished case: a title and the steps (by index) that belong to it. */
export interface Chapter {
  title: string;
  steps: number[];
}

/**
 * The agent's work as one line of steps; selecting a step shows what it did. Used by every agent's case
 * page. With chapters, a finished case reads as a few chapters (Found, Proposed, Decided…); selecting one
 * lists its steps, and "Show All Steps" brings back the full line.
 */
export function StepStrip({ steps, action, initial, chapters }: { steps: Step[]; action?: { label: string; href: string }; /** The step shown first; the last one when absent. */ initial?: number; chapters?: Chapter[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  if (steps.length === 0) return null;
  const sel = Math.min(picked ?? initial ?? steps.length - 1, steps.length - 1);
  const selected = steps[sel]!;
  const grouped = chapters && chapters.length > 1 && !all ? chapters.filter((c) => c.steps.length > 0) : undefined;
  const chapterOf = grouped?.find((c) => c.steps.includes(sel));
  const cell = (i: number, title: string, result: string, time: string, on: boolean, now?: boolean, n?: ReactNode) => (
    <li key={`${title}-${i}`}>
      <button type="button" className={`step${now ? " now" : ""}${on ? " sel" : ""}`} aria-pressed={on} onClick={() => setPicked(i)}>
        <span className="n">
          <i>{n ?? (now ? i + 1 : "✓")}</i>
          {time}
        </span>
        <b>{title}</b>
        <span className="r">{result}</span>
      </button>
    </li>
  );
  return (
    <div className="steps-wrap">
      <ol className={`steps${grouped ? " chapters" : ""}`}>
        {grouped
          ? grouped.map((c, k) => {
              const last = c.steps.at(-1)!;
              const s = steps[last]!;
              return cell(last, c.title, `${c.steps.length} ${c.steps.length === 1 ? "step" : "steps"} · ${s.result}`, steps[c.steps[0]!]!.time, c === chapterOf, s.now, k + 1);
            })
          : steps.map((s, i) => cell(i, s.title, s.result, s.time, i === sel, s.now))}
      </ol>
      <div className="panel sdw" aria-live="polite">
        <div className="row hd">
          <h2 className="sdw-h">
            {chapterOf ? `Chapter ${grouped!.indexOf(chapterOf) + 1} · ${chapterOf.title}: ` : ""}
            Step {sel + 1} of {steps.length}
            {chapterOf && chapterOf.title === selected.title ? "" : ` · ${selected.title}`}
          </h2>
          <span>{grouped ? "Select a chapter above, or a step below" : "Select any step above to see what the agent did"}</span>
          {chapters && chapters.length > 1 && (
            <button type="button" className="link-btn" aria-pressed={all} onClick={() => setAll(!all)}>
              {all ? "Show Chapters" : `Show All ${steps.length} Steps`}
            </button>
          )}
          {action && (
            <a className="btn sm live-entry" href={action.href}>
              {action.label}
            </a>
          )}
        </div>
        {chapterOf && chapterOf.steps.length > 1 && (
          <div className="chapter-steps" role="group" aria-label={`Steps in ${chapterOf.title}`}>
            {chapterOf.steps.map((i) => (
              <button key={i} type="button" className="btn sm" aria-pressed={i === sel} onClick={() => setPicked(i)}>
                {steps[i]!.title}
              </button>
            ))}
          </div>
        )}
        <div className="sd">
          {selected.detail.map((d) => (
            <div key={d.label}>
              <h3 className="lab">{d.label}</h3>
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
  return s < 120 ? `+${s} sec` : s < 7200 ? `+${Math.round(s / 60)} min` : `+${Math.round(s / 3600)} hr`;
}

export { clock };
