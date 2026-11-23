import { Fragment, useState, type ReactNode } from "react";
import { DOCS } from "../docs.js";
import { caseHash } from "../routes.js";
import { caseTag, costText, dateTime, plain, postJson, titleCase, until, usd, type AnyState } from "../api.js";
import { clock, StepStrip, stepTime, type Step } from "../StepStrip.js";
import { Fact, ReviewBar, type ActionProps, type CaseProps } from "../CaseParts.js";
import { Mark, MarkLegend, SheetColumns, SheetHead } from "../sheet.js";
import { vocab } from "../vocab.js";

// The Research Analyst's case sheet: its domain layer (research words and layout), built from shared parts.
export function ResearchCase({ detail, agent, me, onChanged }: CaseProps) {
  const { summary } = detail;
  const s = detail.state!;
  const [tagClass, tagText] = caseTag(summary);
  const timeline: AnyState[] = s.timeline ?? [];
  const sources: Array<Record<string, string>> = s.sources ?? [];
  const cov = detail.research;
  const usage: AnyState[] = s.usage ?? [];
  const deadline = summary.needsPerson ? detail.deadline : undefined;
  const question = cov?.question ?? (s.question as string | undefined);
  // One source carrying every point, or sources the draft leaves out, are what a reviewer must see first.
  const single = cov && cov.points > 0 && cov.cited.length === 1;
  const concerns = cov ? [single && `Every point rests on one source ([${cov.cited[0]}]).`, cov.unrelated.length > 0 && `The agent marked ${cov.unrelated.length} of ${cov.sources} sources as not about the question.`, cov.uncited.length > 0 && `${cov.uncited.length} of ${cov.sources} sources are not cited.`].filter(Boolean) as string[] : [];
  const steps: Step[] = timeline.map((t, i) => {
    const mine = t.state === "now" && summary.needsPerson;
    return {
      title: mine ? "Your Decision" : titleCase(t.name),
      result: mine ? "The brief is not final until you approve" : plain(String(t.detail ?? "")),
      time: stepTime(timeline as Array<{ at: string; state?: string }>, i),
      now: t.state === "now",
      detail: [
        { label: "Recorded", body: <span>{clock(t.at)}</span> },
        { label: "Result", body: <span>{plain(String(t.detail ?? "")) || "Done."}</span> },
        { label: "Sources So Far", body: <span>{sources.length}</span> },
      ],
    };
  });
  const sourceTag = (id: number) =>
    cov?.unrelated.includes(id) ? (
      <span className="tag crit">Marked Unrelated</span>
    ) : cov?.cited.includes(id) ? (
      <span className="tag ok">Cited</span>
    ) : (
      <span className="tag idle">Not Cited</span>
    );
  const v = vocab(agent);
  const layout = agent.layout?.case ?? { main: ["proposal", "sources"], margin: ["legend", "figures", "run"] };
  const blocks: Record<string, ReactNode> = {
    proposal: (
      <section className="sec" aria-labelledby="draft-h">
        <h2 id="draft-h">
          {v.proposal} <span className="sec-sub">draft {s.draftVersion ?? 0}</span>
        </h2>
        {concerns.length > 0 && (
          <p className="gap crit" role="note">
            <b>Check before approving.</b> {concerns.join(" ")}
          </p>
        )}
        <p className="rec" style={{ whiteSpace: "pre-wrap" }}>
          {s.draft?.summary ?? "No draft yet."}
        </p>
        {(s.draft?.keyPoints ?? []).length > 0 && (
          <>
            <h3>Key Points</h3>
            <ul className="rules">
              {(s.draft.keyPoints as string[]).map((p, i) => (
                <li key={i} className={cov && (cov.pointSources[i]?.length ?? 0) === 0 ? "crit" : "note"}>
                  <span className="sr">{cov && (cov.pointSources[i]?.length ?? 0) === 0 ? "Uncited point:" : "Point:"}</span>
                  <div>
                    {p}
                    {cov && <span className="rule-text">{(cov.pointSources[i]?.length ?? 0) === 0 ? "Cites no source" : `Cites ${cov.pointSources[i]!.map((n) => `[${n}]`).join(" ")}`}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    ),
    sources: sources.length > 0 && (
      <section className="sec" aria-labelledby="src-h">
        <h2 id="src-h">
          {v.sources} <span className="sec-sub">{sources.length} gathered</span>
        </h2>
        <ul className="src-list">
          {sources.map((src) => (
            <li key={src.id}>
              <span className="cite">{src.id}</span>
              <a href={src.url} target="_blank" rel="noreferrer">
                {src.title} ↗
              </a>
              {sourceTag(Number(src.id))}
            </li>
          ))}
        </ul>
      </section>
    ),
    legend: <MarkLegend ruleName={v.ruleName} kinds={["recorded", "totalled", "rule", "absent"]} />,
    figures: cov && (
      <section className="sec" aria-labelledby="cov-h">
        <h2 id="cov-h">{v.figures}</h2>
        <dl className="kv">
          <dt>Sources gathered</dt>
          <dd>
            {cov.sources}
            <Mark k="totalled" />
          </dd>
          <dt>Cited in the brief</dt>
          <dd>
            {cov.cited.length}
            <Mark k="rule" />
          </dd>
          <dt>Not cited</dt>
          <dd>
            {cov.uncited.length}
            <Mark k="rule" />
          </dd>
          <dt>Marked unrelated</dt>
          <dd>
            {cov.unrelated.length}
            <Mark k="recorded" />
          </dd>
          <dt>Key points</dt>
          <dd>
            {cov.points}
            <Mark k="recorded" />
          </dd>
        </dl>
      </section>
    ),
    run: (
      <section className="sec" aria-labelledby="rrun-h">
        <h2 id="rrun-h">This Run</h2>
        <dl className="kv">
          <dt>Question</dt>
          <dd>{question ?? "Not recorded"}</dd>
          <dt>Searches</dt>
          <dd>{(s.queries ?? []).length ? (s.queries as string[]).map((q) => `“${q}”`).join(", ") : "–"}</dd>
          <dt>Model cost</dt>
          <dd>
            {costText(summary)}
            <Mark k={summary.costRecorded === false ? "absent" : "totalled"} />
          </dd>
          {usage.map((u, i) => (
            <Fragment key={i}>
              <dt>{titleCase(u.step)}</dt>
              <dd>
                {u.model} · {usd(u.costUsd ?? 0, 4)}
                <Mark k="recorded" />
              </dd>
            </Fragment>
          ))}
          {s.lastFeedback && (
            <>
              <dt>Last feedback</dt>
              <dd>{s.lastFeedback}</dd>
            </>
          )}
        </dl>
      </section>
    ),
  };
  return (
    <>
      <main className="page" aria-labelledby="case-h">
        <div className="sheet">
          <SheetHead
            title={<span id="case-h">{summary.needsPerson ? `Approve the brief on “${question ?? "an unrecorded question"}”?` : (question ?? summary.title)}</span>}
            prepared={
              deadline ? (
                <span className="deadline">
                  <b>Decide within {until(deadline.expiresAt)}</b> (by {dateTime(deadline.expiresAt)}). {deadline.onExpiry}
                </span>
              ) : !question ? (
                "This run started before the portal kept the question; the brief is shown as written."
              ) : !summary.needsPerson && summary.reason ? (
                `${plain(summary.reason)}.`
              ) : (
                "Prepared by the run · decided by a person"
              )
            }
            refLine={`${v.case} ${summary.ref || summary.workflowId}`}
            refSub={<span className={`tag ${tagClass}${summary.needsPerson ? " solid" : ""}`}>{summary.needsPerson ? "Needs Decision" : tagText}</span>}
          />
          <dl className="meta">
            <Fact k="Sources" v={cov ? `${cov.cited.length} cited of ${cov.sources}` : String(sources.length)} mark={cov ? "rule" : "totalled"} />
            <Fact k="Model Cost" v={costText(summary)} mark={summary.costRecorded === false ? "absent" : "totalled"} />
          </dl>
          <StepStrip steps={steps} />
          <SheetColumns layout={layout} blocks={blocks} />
        </div>
      </main>
      {summary.needsPerson && (
        <ReviewBar
          workflowId={summary.workflowId}
          me={me}
          approveLabel={v.approve}
          sendBackHint={v.sendBackHint}
          ifApprove="the brief is marked approved and the run finishes. Nothing outside the portal changes."
          ifSendBack="the agent revises the draft using your feedback and brings a new version back to you."
          conflictHint={concerns.length ? concerns.join(" ") : undefined}
          conflictTitle="Check the sources first."
          checkLabel="Source check"
          sendBackPresets={["Cite only sources about the question", "Say plainly what the sources do not answer", "Support each point with more than one source"]}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

/** The Research Analyst's agent-page action: start a brief on a typed question (demo deployments only). */
export function ResearchActions({ agent, demoControls, onNav }: ActionProps) {
  const [queueMsg, setQueueMsg] = useState<{ text: string; error?: boolean }>();
  const [question, setQuestion] = useState("");
  const [briefBusy, setBriefBusy] = useState(false);
  if (!demoControls) return null;
  return (
      <form
        className="brief-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (briefBusy || question.trim().length < 10) return;
          setBriefBusy(true);
          setQueueMsg(undefined);
          postJson<{ workflowId: string }>("/api/demo/research-brief", { question: question.trim() })
            .then((r) => onNav(caseHash(agent.id, r.workflowId)))
            .catch((err: Error) => setQueueMsg({ text: `The brief did not start: ${err.message}.`, error: true }))
            .finally(() => setBriefBusy(false));
        }}
      >
        <label htmlFor="brief-q" className="sr">
          Research question
        </label>
        <input id="brief-q" type="text" className="search" value={question} minLength={10} maxLength={500} placeholder="A question, e.g. How do durable workflows survive a crash?" onChange={(e) => setQuestion(e.target.value)} />
        <button type="submit" className="btn sm primary" disabled={briefBusy || question.trim().length < 10} aria-describedby="brief-hint">
          {briefBusy ? "Starting…" : "Start a Research Brief"}
        </button>
        <span id="brief-hint" className={queueMsg?.error ? "form-error inline" : "muted"} role={queueMsg?.error ? "alert" : undefined} style={{ fontSize: 13.5 }}>
          {queueMsg?.error ? queueMsg.text : question.trim().length < 10 ? "Ask a full question, at least 10 characters." : "The agent researches it and brings a cited brief back for your approval."}
        </span>
      </form>
  );
}

/** What the Research Analyst's empty case list says. */
export function ResearchEmpty({ demoControls }: { demoControls: boolean }) {
  return (
      <>
        No research cases yet.{" "}
        {demoControls ? "Start one with Start a Research Brief above." : <>Start one from the command line with <code className="mono">temporal workflow start --type researchAndSummarize</code>.</>} The{" "}
        <a href={`${DOCS.repo}/tree/main/agents/general/research-summarize#readme`} target="_blank" rel="noreferrer">
          agent’s README ↗
        </a>{" "}
        explains what a brief contains.
      </>
  );
}
