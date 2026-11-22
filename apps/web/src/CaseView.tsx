import { caseHash, liveHash } from "./routes.js";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ago, cents, caseTag, duration, costText, dateTime, plain, postJson, shortDate, sourceLabel, titleCase, until, usd, usePoll, type Agent, type AnyState, type CaseDetail, type CasePage, type PersonReason, type Skill, type WriteRecord } from "./api.js";
import { approveEffect, decisionOutcome, escalateEffect, sendBackEffect } from "./effects.js";
import { Close } from "./icons.js";
import { Inspector } from "./Inspector.js";
import { Term } from "./Glossary.js";
import { clock, StepStrip, stepTime, type Chapter, type Step } from "./StepStrip.js";

const POLICY_SKILL = "ap-resolution-policy";
const RELEVANCE: Record<string, [string, string]> = { supports: ["ok", "Supports"], contradicts: ["crit", "Contradicts"], not_applicable: ["idle", "Not Applicable"] };

/** The selected case as a page: the decision first, then the agent's work, the numbers, the evidence and the audit trail. */
type CaseProps = { detail: CaseDetail; agent: Agent; me: string; onBack: () => void; onChanged: () => void; onNav: (hash: string) => void };

export function CaseView(props: CaseProps & { onRef?: (workflowId: string, ref: string) => void }) {
  const { detail, onRef } = props;
  const { workflowId } = detail.summary;
  const ref = detail.summary.ref || workflowId;
  useEffect(() => onRef?.(workflowId, ref), [workflowId, ref, onRef]);
  if (!detail.state) {
    return (
      <main className="page">
        <div className="panel empty">{detail.summary.reason ?? "This run has no state to show (it may have failed to start)."}</div>
      </main>
    );
  }
  return detail.agentId === "research-summarize" ? <ResearchCase {...props} /> : <InvoiceCase {...props} />;
}

type Mode = "choose" | "approve" | "back" | "escalate";

function ReviewBar(props: {
  workflowId: string;
  me: string;
  approveLabel: string;
  ifApprove: string;
  ifSendBack: string;
  /** Present when the case can be handed to a person. */
  ifEscalate?: string;
  /** When a rule found a conflict: suggested feedback, and sending back becomes the primary action. */
  conflictHint?: string;
  /** The heading for that warning in the approve dialog. */
  conflictTitle?: string;
  /** Who recommends sending back: the deterministic check, never the agent. */
  checkLabel?: string;
  /** What approving will write, shown in the approval dialog. */
  approveFacts?: Array<[string, string]>;
  /** Whether the workflow keeps a note with an approval. A conflict makes the reason required. */
  approveNote?: boolean;
  /** Ready-made feedback for Send Back, so a phone user can pick one instead of typing. */
  sendBackPresets?: string[];
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [feedback, setFeedback] = useState(props.conflictHint ?? "");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const conflict = Boolean(props.conflictHint);
  // The native dialog gives the focus trap, Escape to close and the backdrop.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!mode) {
      if (d.open) d.close();
      return;
    }
    if (!d.open) d.showModal();
    const t = d.querySelector("textarea");
    if (t) {
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    } else d.querySelector<HTMLElement>("[data-first]")?.focus();
  }, [mode]);
  // Keyboard: A approve, S send back, E escalate, each opening its dialog. Never while typing or with a dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode || busy || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true'], dialog")) return;
      const k = e.key.toLowerCase();
      const next: Mode | undefined = k === "a" ? "approve" : k === "s" ? "back" : k === "e" && props.ifEscalate ? "escalate" : undefined;
      if (!next) return;
      e.preventDefault();
      setMode(next);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [mode, busy, props.ifEscalate]);
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await postJson(`/api/cases/${props.workflowId}/review`, body);
      setFeedback("");
      setNote("");
      setReason("");
      setMode(null);
      props.onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const form =
    mode === "approve"
      ? { title: props.approveLabel, effect: props.ifApprove, label: conflict ? "Reason for Approving Against the Policy" : "Note for the Record (Optional)", text: reason, set: setReason, required: conflict, confirm: props.approveLabel, placeholder: conflict ? "Why this should be approved although the policy points elsewhere" : "Anything the record should say about this approval" }
      : mode === "back"
        ? { title: "Send Back to Agent", effect: props.ifSendBack, label: "Feedback for the Agent", text: feedback, set: setFeedback, required: true, confirm: "Send Back to Agent", placeholder: "Tell the agent what to do instead, e.g. ask the vendor for a credit memo" }
        : mode === "escalate"
          ? { title: "Escalate to AP Specialist", effect: props.ifEscalate ?? "", label: "Note for the AP Specialist", text: note, set: setNote, required: true, confirm: "Confirm Escalation", placeholder: "What the specialist should check, e.g. the buyer should confirm this price with the vendor" }
          : null;
  const showText = form && (mode !== "approve" || props.approveNote);
  const ready = form ? !showText || !form.required || Boolean(form.text.trim()) : false;
  const submit = () => {
    if (!form || !ready || busy) return;
    const text = showText ? form.text.trim() : "";
    void send(mode === "approve" ? { approved: true, ...(text ? { feedback: text } : {}) } : mode === "back" ? { approved: false, feedback: text } : { escalate: { note: text } });
  };
  const KEY: Partial<Record<Mode, string>> = { approve: "A", back: "S", escalate: "E" };
  const action = (m: Mode, label: string, primary: boolean, first?: boolean) => (
    <button key={m} type="button" className={`btn${primary ? " primary" : ""}`} disabled={busy} aria-haspopup="dialog" aria-keyshortcuts={KEY[m]} data-first={first ? "" : undefined} onClick={() => setMode(m)}>
      {label}…
    </button>
  );
  const actions = (first?: boolean) => {
    const approve = action("approve", props.approveLabel, !conflict, first && !conflict);
    const back = action("back", "Send Back to Agent", conflict, first && conflict);
    return (
      <>
        {conflict ? back : approve}
        {conflict ? approve : back}
        {props.ifEscalate && action("escalate", "Escalate to AP Specialist", false)}
      </>
    );
  };
  const lead = conflict ? (
    <>
      <b>{props.checkLabel ?? "Policy check"}: send back.</b> {props.conflictHint} <b>If you approve anyway:</b> {props.ifApprove}
    </>
  ) : (
    <>
      <b>If you approve:</b> {props.ifApprove}
    </>
  );
  return (
    <section className="dbar" aria-label="Your decision">
      {/* The bar always shows what approving does, in full, on its own row; the verdict is a short tag. The dialog carries the reason. */}
      <div className="what">
        {conflict && <span className="tag crit verdict">{props.checkLabel ?? "Policy check"}: Send Back</span>}
        <b>{conflict ? "If you approve anyway:" : "If you approve:"}</b> {props.ifApprove}
      </div>
      <div className="dbar-actions">{actions()}</div>
      <button type="button" className="btn primary dbar-decide" disabled={busy} aria-haspopup="dialog" onClick={() => setMode("choose")}>
        Decide…
      </button>
      <span className="who">
        Recorded as {props.me}
        <span className="keys" aria-hidden="true">
          {" "}
          · Keys: <kbd>A</kbd> Approve, <kbd>S</kbd> Send Back{props.ifEscalate ? <>, <kbd>E</kbd> Escalate</> : null}
        </span>
      </span>
      {error && !mode && (
        <span className="form-error" role="alert">
          The decision was not recorded: {error}
        </span>
      )}

      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="decide-h"
        onClose={() => setMode(null)}
        onClick={(e) => {
          if (e.target === dialog.current && !busy) setMode(null);
        }}
      >
        {mode === "choose" && (
          <div className="modal-body">
            <header>
              <h2 id="decide-h">Your Decision</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setMode(null)}>
                <Close />
              </button>
            </header>
            <p className="modal-effect">{lead}</p>
            <div className="modal-choices">{actions(true)}</div>
            <footer>
              <span className="who">Recorded as {props.me}</span>
            </footer>
          </div>
        )}
        {form && (
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <header>
              <h2 id="decide-h">{form.title}</h2>
              <button type="button" className="icon-btn" aria-label="Close" disabled={busy} onClick={() => setMode(null)}>
                <Close />
              </button>
            </header>
            {mode === "approve" && conflict && (
              <div className="gap crit">
                <b>{props.conflictTitle ?? "This conflicts with the policy."}</b> {props.conflictHint}
              </div>
            )}
            <p className="modal-effect">
              <b>What happens:</b> {form.effect}
            </p>
            {mode === "approve" && props.approveFacts && props.approveFacts.length > 0 && (
              <dl className="kv modal-facts">
                {props.approveFacts.map(([k, v]) => (
                  <Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </Fragment>
                ))}
              </dl>
            )}
            {showText && (
              <>
                <label htmlFor="decide-text" className="lab">
                  {form.label}
                </label>
                <textarea
                  id="decide-text"
                  rows={mode === "approve" ? 3 : 7}
                  className={mode === "approve" ? "short" : undefined}
                  value={form.text}
                  required={form.required}
                  placeholder={form.placeholder}
                  onChange={(e) => form.set(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
                  }}
                />
              </>
            )}
            {mode === "back" && conflict && feedback === props.conflictHint && <span className="muted">Suggested from the policy conflict. Edit it as you need.</span>}
            {mode === "back" && props.sendBackPresets && props.sendBackPresets.length > 0 && (
              <div className="presets" role="group" aria-label="Common Feedback">
                <span className="muted">Common feedback:</span>
                {props.sendBackPresets.map((p) => (
                  <button key={p} type="button" className="btn sm" aria-pressed={feedback === p} onClick={() => setFeedback(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}
            {error && (
              <span className="form-error" role="alert">
                The decision was not recorded: {error}. Your text is kept; try again.
              </span>
            )}
            <footer>
              <span className="who">
                Recorded as {props.me}
                {showText ? " · Ctrl+Enter to confirm" : ""}
              </span>
              <button type="button" className="btn" disabled={busy} data-first={showText ? undefined : ""} onClick={() => setMode(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy || !ready} aria-describedby={!ready ? "decide-hint" : undefined}>
                {busy ? "Sending…" : form.confirm}
              </button>
              {!ready && (
                <span id="decide-hint" className="form-hint">
                  {conflict && mode === "approve" ? "A reason is required to approve against the policy." : `Write the ${form.label.toLowerCase().replace(/ \(optional\)$/, "")} to confirm.`}
                </span>
              )}
            </footer>
          </form>
        )}
      </dialog>
    </section>
  );
}

/** Rationale text with [E1, E2] references turned into citation tags. */
function cited(text: string): ReactNode[] {
  return text.split(/(\[E\d+(?:\s*,\s*E\d+)*\])/g).map((part, i) =>
    /^\[E\d/.test(part) ? (
      <Fragment key={i}>
        {part
          .slice(1, -1)
          .split(/\s*,\s*/)
          .map((r, j) => (
            <Fragment key={r}>
              {j > 0 && " "}
              <span className="cite">{r}</span>
            </Fragment>
          ))}
      </Fragment>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function BackLink({ agent }: { agent: Agent; onBack?: () => void }) {
  return (
    <a className="back-link" href={`#/agent/${agent.id}`}>
      ‹ All {agent.name} Cases
    </a>
  );
}

const GROUP: Record<PersonReason["group"], string> = { policy: "Policy", risk: "Risk", evidence: "Evidence" };

/** After a decision: the oldest other case waiting on a person, one click away. */
function NextDecision({ current }: { current: string }) {
  const page = usePoll<CasePage>("/api/cases?needs=1&sort=age&dir=asc&limit=20", 10_000).data;
  if (!page) return null;
  const next = page.cases.find((c) => c.workflowId !== current);
  if (!next) return <span className="muted">No other decisions are waiting.</span>;
  const others = page.cases.filter((c) => c.workflowId !== current).length;
  return (
    <a className="btn sm primary" href={caseHash(next.agentId, next.workflowId)}>
      Next Decision: Case {next.ref}
      {others > 1 ? ` (${others} Waiting)` : ""} ›
    </a>
  );
}

/** One ERP write and what allowed it. */
function WriteLine({ w }: { w: WriteRecord }) {
  return (
    <li className={w.by === "person" ? "pass" : "note"}>
      <span className="sr">{w.by === "person" ? "Allowed by a person:" : "Allowed by a rule:"}</span>
      <div>
        <b>{w.label}.</b> {w.why}
      </div>
    </li>
  );
}

function InvoiceCase({ detail, agent, me, onBack, onChanged }: CaseProps) {
  const { summary, facts } = detail;
  const s = detail.state!;
  const [tagClass, tagText] = caseTag(summary);
  const proposal = s.proposal;
  const evidence: AnyState[] = s.evidence ?? [];
  const citedRefs = new Set<string>(proposal?.citedEvidence ?? []);
  const route = s.route;
  const timeline: AnyState[] = s.timeline ?? [];
  const calls: AnyState[] = s.toolCalls ?? [];
  const usage: AnyState[] = s.usage ?? [];
  const cost = usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
  const [reason, setReason] = useState("");
  const [recheck, setRecheck] = useState<{ busy?: boolean; error?: string; sent?: boolean }>({});
  const writes = detail.writes ?? [];
  const decision = detail.decision;

  const policyVersion: string | undefined = s.skillVersions?.[POLICY_SKILL];
  const policy = usePoll<Skill>(policyVersion ? `/api/agents/${agent.id}/skills/${POLICY_SKILL}?version=${encodeURIComponent(policyVersion)}` : null, 600_000).data;
  const rule = (action?: string) => policy?.actions.find((a) => a.action === action);

  const vendor = facts?.vendorName;
  const invNo: string | undefined = s.invoice?.vendorInvoiceNumber;
  const exception = (proposal?.exceptionType ?? s.match?.exceptionTypes?.[0] ?? "exception").replace(/_/g, " ");
  const amount: number | undefined = s.adjustment?.amountCents;
  // One name for each identifier: "vendor invoice SAL-…" is the vendor's number, "case INV-…" is ours.
  const subject = invNo ? `vendor invoice ${invNo}${vendor ? ` from ${vendor}` : ""}` : `case ${summary.ref}`;
  const actionLabel = titleCase(proposal?.action);
  const routeFit: { fits: boolean; expected?: string; why?: string } | undefined = s.route?.policyFit;
  // One headline form for every case, waiting or decided: what the agent proposed, and the policy check when it disagrees.
  // What was decided is the receipt band's job.
  const headline = proposal
    ? `The agent ${summary.needsPerson ? "proposes" : "proposed"} ${actionLabel} for the ${amount != null ? `${cents(Math.abs(amount))} ` : ""}${exception} on ${subject}.${
        routeFit && !routeFit.fits ? ` The policy check points to ${routeFit.expected ? titleCase(routeFit.expected) : "a different action"}.` : ""
      }`
    : `The three-way match found a ${exception} on ${subject}.`;

  // The numbers: unit prices from the match engine's finding, quantity and item from the ERP line.
  const finding: AnyState | undefined = (s.match?.findings ?? []).find((f: AnyState) => f.details?.invoicedUnitPriceCents != null && f.details?.poUnitPriceCents != null);
  const d = finding?.details;
  const line = facts?.lines.find((l) => l.lineNo === finding?.lineNo);
  const qty = line?.quantity;
  const basePct = d ? (100 * d.poUnitPriceCents) / d.invoicedUnitPriceCents : 0;
  const overPct = d && d.poUnitPriceCents ? (100 * (d.invoicedUnitPriceCents - d.poUnitPriceCents)) / d.poUnitPriceCents : 0;

  // Why a person: the rules that fired, with the approval line drawn when one of them is the threshold.
  const reasons: string[] = route?.reasons ?? s.reasons ?? [];
  const over = detail.threshold ? { amount: detail.threshold.amountCents / 100, limit: detail.threshold.lineCents / 100 } : null;
  const scale = over ? Math.max(over.amount * 1.1, over.limit * 1.5) : 1;
  const routing =
    s.status === "blocked" || s.status === "escalated"
      ? `${s.status === "blocked" ? "Blocked" : "Escalated to a person"}. The invoice is held.`
      : s.status === "on_hold"
        ? "The invoice stays on hold."
        : route?.path === "escalate"
          ? "Goes to a person. The invoice is held."
          : route?.needsPerson
            ? s.reviewer
              ? `Approved by ${s.reviewer}.`
              : null
            : route
              ? writes.length
                ? "No person was needed. Each write to the ERP below names the rule that allowed it."
                : "No rule required a person."
              : "The agent is still working on this case.";
  const note = detail.decision?.escalationNote;
  const closing: string[] = s.status ? (s.reasons ?? []).filter((r: string) => !reasons.includes(r) && r !== note && !/^escalated by /.test(r)) : [];
  const personReasons = detail.personReasons ?? [];
  const deadline = summary.needsPerson ? detail.deadline : undefined;

  const fit: { fits: boolean; expected?: string; why?: string } | undefined = route?.policyFit;
  const conflict = fit && !fit.fits ? fit : undefined;
  const alternatives: Array<{ action: string; whyNot: string }> = proposal?.alternatives ?? [];

  const proposedAt = timeline.find((t) => /propose/i.test(t.name))?.at;
  const seconds = proposedAt && timeline[0] ? Math.round((Date.parse(proposedAt) - Date.parse(timeline[0].at)) / 1000) : null;

  const steps: Step[] = timeline.map((t, i) => {
    const isRoute = /^route$/i.test(t.name);
    const now = t.state === "now";
    const mine = now && summary.needsPerson;
    const from = i > 0 ? Date.parse(timeline[i - 1]!.at) : -Infinity;
    const stepCalls = calls.filter((c) => Date.parse(c.at) > from && Date.parse(c.at) <= Date.parse(t.at));
    const stepCost = usage.filter((u) => String(t.name).toLowerCase().includes(String(u.step).toLowerCase().split(" ")[0]!)).reduce((a, u) => a + (u.costUsd ?? 0), 0);
    return {
      title: i === 0 && /^match$/i.test(t.name) && s.match?.exceptionTypes?.length ? `${titleCase(s.match.exceptionTypes[0])} Found` : isRoute ? "Checked Rules" : mine ? "Your Decision" : titleCase(t.name),
      result:
        i === 0 && finding && d
          ? `Three-way match: line ${finding.lineNo} billed at ${cents(d.invoicedUnitPriceCents)} a unit; PO says ${cents(d.poUnitPriceCents)}`
          : isRoute
            ? reasons.length
              ? `${reasons.length} ${reasons.length === 1 ? "rule requires" : "rules require"} a person`
              : "Within policy"
            : mine
              ? "Nothing posts until you approve"
              : // The escalation note is shown once, in the decision band; the strip names who acted.
                /^escalated by reviewer$/i.test(t.name)
                ? `Escalated by ${s.reviewer ?? "a reviewer"}`
                : note && String(t.detail ?? "").includes(note)
                  ? "Invoice on hold; the case is with an AP specialist"
                  : plain(String(t.detail ?? "").replace(/^exception:\s*/i, "")),
      time: stepTime(timeline as Array<{ at: string; state?: string }>, i),
      now,
      detail: [
        // A step that ran nothing has no What Ran cell; the route and a paused step say what they did instead.
        ...(!stepCalls.length && !isRoute && !now ? [] : [{
          label: "What Ran",
          body: stepCalls.length ? (
            stepCalls.map((c, k) => {
              const w = writes.find((x) => x.ref === c.ref && x.at === c.at);
              return (
                <span key={k}>
                  {sourceLabel(c.ref)}{" "}
                  <span className="muted">
                    · {c.outcome}, {c.durationMs} ms
                  </span>
                  {w && <span className={`allowed ${w.by}`}> · {w.by === "person" ? `Approved by ${w.who ?? "a person"}` : "Allowed by a rule (see Routing)"}</span>}
                </span>
              );
            })
          ) : (
            <span>{isRoute ? "The workflow checked the proposal against fixed rules. The model cannot override them." : "The run is paused. It resumes from here when a person decides."}</span>
          ),
        }]),
        {
          label: isRoute || now ? "Rules" : "Recorded",
          body:
            isRoute || now ? (
              // The rules are stated once, in the routing panel; the step only counts them.
              <span>
                {reasons.length ? `${reasons.length} ${reasons.length === 1 ? "rule requires" : "rules require"} a person; see Why This Is with You.` : "No rule required a person."}
              </span>
            ) : (
              <span>
                {clock(t.at)}
                {stepCost ? ` · model cost ${usd(stepCost, 4)}` : ""}
              </span>
            ),
        },
        {
          label: "Result",
          body: (
            <span>
              {mine ? "Nothing is written to the ERP until you approve." : plain(String(t.detail ?? "")) || "Done."}
              {/^match$/i.test(t.name) && (
                <span className="muted" style={{ display: "block", marginTop: 4 }}>
                  A <Term term="Three-way match">three-way match</Term> checks the invoice against its purchase order and the goods receipt; a difference beyond the tolerance is an exception.
                </span>
              )}
            </span>
          ),
        },
      ],
    };
  });

  // Every case reads as the same chapters; while a person must decide, that chapter is "Your Decision".
  const CHAPTER: Array<[string, RegExp]> = [
    ["Found", /^(match|read invoice)/i],
    ["Investigated", /^gather evidence/i],
    ["Proposed", /^(propose|revise|route)/i],
    [summary.needsPerson ? "Your Decision" : "Decided", /^(waiting for approval|approved|sent back|escalated by reviewer)/i],
  ];
  const chapters: Chapter[] | undefined =
    steps.length > 3
      ? (() => {
          const out: Chapter[] = [...CHAPTER.map(([title]) => ({ title, steps: [] as number[] })), { title: "Carried Out", steps: [] }];
          let at = 0;
          timeline.forEach((t, i) => {
            const k = CHAPTER.findIndex(([, re]) => re.test(String(t.name)));
            at = k >= 0 ? k : at >= CHAPTER.length - 1 || /^(post|confirm|message|finished|hold|waiting for receipt|receipt|reminder|invoice)/i.test(String(t.name)) ? CHAPTER.length : at;
            out[at]!.steps.push(i);
          });
          return out;
        })()
      : undefined;

  const outcome = decisionOutcome({ actionLabel, ref: summary.ref, path: route?.path, amountCents: amount, payableCents: s.adjustment?.payableCents, status: s.status, decision });
  // A decided case opens on the step that carried the decision out, not on "Finished".
  const carriedAt = decision?.postedAt ?? decision?.escalatedAt ?? decision?.approvedAt;
  const decidedStep = summary.needsPerson || !carriedAt ? -1 : timeline.findIndex((t) => t.at === carriedAt);

  const approveLabel = route?.path === "post" ? "Approve and Post to ERP" : route?.path === "hold" || route?.path === "wait" ? "Approve and Hold Invoice" : "Approve";
  const ifApprove = approveEffect({ actionLabel, ref: summary.ref, path: route?.path, amountCents: amount, payableCents: s.adjustment?.payableCents, messageTo: route?.message?.recipient });
  const waitingSince = Date.parse(timeline.find((t) => t.state === "now")?.at ?? summary.startedAt);
  const waited = ago(new Date(waitingSince).toISOString());

  return (
    <>
      <main className="page" aria-labelledby="case-h">
        <div className="dh">
          <div className="row" style={{ alignItems: "center" }}>
            <span className={`tag ${summary.needsPerson && conflict ? "crit" : tagClass}${summary.needsPerson ? " solid" : ""}`}>{summary.needsPerson ? `Needs Decision${conflict ? " · Conflicts with Policy" : ""} · Waiting ${waited}` : tagText}</span>
            {summary.overridden && <span className="tag warn">Approved Against Policy</span>}
            <BackLink agent={agent} onBack={onBack} />
          </div>
          <h1 id="case-h">{headline}</h1>
          {!summary.needsPerson && !outcome && summary.reason && <p className="why">{plain(summary.reason)}.</p>}
          {deadline && (
            <p className="why deadline">
              <b>Decide within {until(deadline.expiresAt)}</b> (by {dateTime(deadline.expiresAt)}). {deadline.onExpiry}
            </p>
          )}
          <dl className="meta">
            {vendor && <Fact k="Vendor" v={vendor} />}
            {invNo && <Fact k="Vendor Invoice" v={invNo} />}
            {s.invoice?.totalDue && <Fact k="Invoice Total" v={s.invoice.totalDue} />}
            {s.invoice?.poReference && <Fact k="Purchase Order" v={s.invoice.poReference} />}
            {s.invoice?.invoiceDate && <Fact k="Invoice Date" v={shortDate(s.invoice.invoiceDate)} />}
            {facts?.dueDate && <Fact k="Due" v={shortDate(facts.dueDate)} />}
            <Fact k="Case" v={summary.ref} />
          </dl>
        </div>

        {outcome && (
          <section className={`outcome ${outcome.tone}`} aria-label="Decision">
            <span className={`tag ${outcome.tone}`}>{outcome.title}</span>
            <p>{outcome.body}</p>
            {(decision?.approvedAt || decision?.escalatedAt) && <NextDecision current={summary.workflowId} />}
            {writes.length > 0 && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  const el = document.getElementById("audit");
                  if (el instanceof HTMLDetailsElement) el.open = true;
                  el?.scrollIntoView({ block: "start" });
                }}
              >
                See the {writes.length === 1 ? "ERP Write" : `${writes.length} ERP Writes`} in the Audit Trail
              </button>
            )}
          </section>
        )}

        <StepStrip
          key={decidedStep}
          initial={decidedStep >= 0 ? decidedStep : undefined}
          steps={steps}
          chapters={chapters}
          action={{ label: "Open Run View", href: liveHash(agent.id, summary.workflowId) }}
        />

        <div className="g2">
          <div className="gcol">
            {d && (
              <section className="panel card" aria-labelledby="num-h">
                <h2 id="num-h" className="lab">
                  {["The Numbers", `Line ${finding!.lineNo}`, line?.itemId].filter(Boolean).join(" · ")}
                  {(line?.description || qty != null) && (
                    <span className="keep-case">
                      {" · "}
                      {[line?.description, qty != null ? `${qty} ${line?.uom ?? "units"}` : null].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </h2>
                <div className="big">
                  <b>{cents(finding!.amountCents)}</b>
                  <span>{overPct.toFixed(1)}% over the purchase order</span>
                </div>
                <div className="bars">
                  {qty != null && (
                    <>
                      <div className="lab sub">Line Total</div>
                      <span>Purchase order</span>
                      <Bar base={basePct} />
                      <span className="amt">{cents(qty * d.poUnitPriceCents)}</span>
                      <span>Invoiced</span>
                      <Bar base={basePct} over />
                      <span className="amt">{cents(qty * d.invoicedUnitPriceCents)}</span>
                    </>
                  )}
                  <div className="lab sub">Unit Price</div>
                  <span>Purchase order</span>
                  <Bar base={basePct} />
                  <span className="amt">{cents(d.poUnitPriceCents)}</span>
                  {d.contractPriceCents != null && (
                    <>
                      <span>Contract on file</span>
                      <Bar base={(100 * d.contractPriceCents) / d.invoicedUnitPriceCents} />
                      <span className="amt">{cents(d.contractPriceCents)}</span>
                    </>
                  )}
                  <span>Invoiced</span>
                  <Bar base={basePct} over />
                  <span className="amt">{cents(d.invoicedUnitPriceCents)}</span>
                </div>
              </section>
            )}

            <section className="panel card" aria-labelledby="rec-h">
              <div className="row">
                <h2 id="rec-h" className="lab">
                  Agent’s Proposal
                </h2>
                {proposal && (
                  <span className="tag idle">
                    {actionLabel} · {titleCase(proposal.confidence)} Confidence
                  </span>
                )}
              </div>
              {conflict && (
                <div className="gap crit" role="alert">
                  <b>Conflicts with policy.</b> {plain(conflict.why)}.{conflict.expected ? ` The policy points to ${titleCase(conflict.expected)}.` : ""}
                </div>
              )}
              {proposal && (
                <h3 className="lab sub-h">
                  Agent’s Reasoning{Number(s.draftVersion ?? 1) > 1 ? ` · Draft ${s.draftVersion}` : ""}
                  {conflict ? " · Not Supported by the Policy Check" : ""}
                </h3>
              )}
              <p className={`rec${conflict ? " quiet" : ""}`}>{proposal?.rationale ? cited(proposal.rationale) : "No proposal yet."}</p>
              {proposal && (
                <p className="muted conf-note">
                  <Term term="Confidence" /> is the agent’s own rating of its evidence: high, medium or low. Low always goes to a person; at high or medium the routing rules decide.
                </p>
              )}
              {proposal?.unconfirmed ? (
                <div className="gap">
                  <b>Not confirmed.</b> {proposal.unconfirmed}
                </div>
              ) : null}
              {s.citationsValid === false && (
                <div className="gap">
                  <b>Citation check failed.</b> The proposal cites evidence that does not exist.
                </div>
              )}

              {proposal && (fit || alternatives.length > 0 || rule(proposal.action)) && (
                <div className="opts" aria-labelledby="opts-h">
                  <h3 id="opts-h" className="lab">
                    Options
                  </h3>
                  <Option kind="Agent proposed" action={proposal.action} text={rule(proposal.action)?.useWhen} verdict={fit ? (fit.fits ? "fits" : "conflict") : undefined} />
                  {conflict?.expected && <Option kind="Policy check points to" action={conflict.expected} text={rule(conflict.expected)?.useWhen} verdict="fits" />}
                  {alternatives
                    .filter((a) => a.action !== conflict?.expected)
                    .map((a) => (
                      <Option key={a.action} kind="Agent weighed" action={a.action} text={a.whyNot} quoted />
                    ))}
                </div>
              )}

              {policy && (
                <details className="pol">
                  <summary>
                    AP Resolution Policy {policy.version} · View Full Policy
                  </summary>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>Use When</th>
                          <th>Effect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {policy.actions.map((a) => (
                          <tr key={a.action} className={a.action === proposal?.action ? "hl" : undefined}>
                            <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{titleCase(a.action)}</td>
                            <td>{a.useWhen}</td>
                            <td>{a.effect}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </section>

            {evidence.length > 0 && (
              <section className="panel card" aria-labelledby="ev-h">
                <div className="row">
                  <h2 id="ev-h" className="lab">
                    Evidence · {evidence.length} {evidence.length === 1 ? "Item" : "Items"}
                  </h2>
                  <span className="muted" style={{ fontSize: 13.5 }}>
                    {citedRefs.size} cited in the recommendation
                  </span>
                </div>
                <div className="ev">
                  {evidence.map((e, idx) => {
                    const sum = detail.evidence?.[e.ref];
                    // The same tool called twice (a second search) says which call this is.
                    const same = evidence.filter((x) => x.source === e.source).length;
                    const nth = evidence.slice(0, idx + 1).filter((x) => x.source === e.source).length;
                    const title = `${sum?.title ?? sourceLabel(e.source)}${same > 1 && /search|list/.test(String(e.source)) ? ` · Search ${nth} of ${same}` : ""}`;
                    const body = sum?.body ?? "No summary was recorded for this item. Open the raw output below.";
                    const rel = e.relevance ? RELEVANCE[e.relevance] : undefined;
                    return (
                      <div key={e.ref}>
                        <div className="h">
                          <b>
                            <span className="cite">{e.ref}</span> {title}
                          </b>
                          {/* Stance and citation are two facts: show both, so the count above always matches. */}
                          <span className="ev-tags">
                            {rel && <span className={`tag ${rel[0]}`}>{rel[1]}</span>}
                            <span className="src">{citedRefs.has(e.ref) ? "Cited" : "Not cited"}</span>
                          </span>
                        </div>
                        <span>{body}</span>
                        {e.relevanceNote ? <span className="muted">Agent’s note: {e.relevanceNote}</span> : !citedRefs.has(e.ref) && <span className="muted">The agent gathered this but did not cite it or note why.</span>}
                        <details>
                          <summary>Raw Output · {e.source}</summary>
                          <pre className="detail">{String(e.excerpt)}</pre>
                        </details>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {s.message && (
              <section className="panel card">
                <div className="row">
                  <h2 className="lab">Message Queued</h2>
                  <span className="muted" style={{ fontSize: 13.5 }}>
                    To {s.message.to}
                  </span>
                </div>
                <div style={{ fontWeight: 600 }}>{s.message.subject}</div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{s.message.body}</div>
              </section>
            )}
          </div>

          <div className="gcol">
            <section className="panel card" aria-labelledby="why-h">
              <h2 id="why-h" className="lab">
                {summary.needsPerson ? "Why This Is with You" : "Routing"}
              </h2>
              <p className="muted terms-line">
                Fixed rules decide this, not the model: the <Term term="Approval line">approval line</Term>, <Term term="Policy fit">policy fit</Term> and the <Term term="Protective hold">protective hold</Term>.
              </p>
              <ul className="rules">
                {routing && (
                  <li className="note">
                    <span className="sr">Note:</span>
                    <div>{routing}</div>
                  </li>
                )}
                {closing.map((r) => (
                  <li key={r} className="note">
                    <span className="sr">Note:</span>
                    <div>{plain(r)}.</div>
                  </li>
                ))}
                {(personReasons.length ? personReasons : reasons.map((r): PersonReason => ({ kind: "", group: "policy", label: plain(r), rule: r }))).map((pr) => {
                  const crit = pr.kind === "policy_conflict" || pr.group === "risk";
                  const r = pr.rule ?? pr.label;
                  return (
                    <li key={pr.label} className={crit ? "crit" : undefined}>
                      <span className="sr">{crit ? "Conflict or risk:" : "Rule requiring a person:"}</span>
                      <div>
                        <span className="why-group">{GROUP[pr.group]}</span> {pr.label}.
                        {pr.rule && personReasons.length > 0 && (pr.kind === "policy_conflict" || pr.group !== "policy") && <span className="rule-text">Rule: {plain(pr.rule)}</span>}
                        {over && pr.kind === "approval_line" && (
                          <div className="meter" role="img" aria-label={`${cents(over.amount * 100)} against a ${cents(over.limit * 100)} approval line`}>
                            <i style={{ width: `${Math.min(100, (100 * over.amount) / scale)}%` }} />
                            <span className="meter-line" style={{ left: `${(100 * over.limit) / scale}%` }}>
                              <span>{cents(over.limit * 100)} line</span>
                            </span>
                            <span className="meter-end" style={{ left: 0 }}>
                              $0
                            </span>
                            <span className="meter-end" style={{ right: 0 }}>
                              {cents(Math.round(scale) * 100)}
                            </span>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
                {conflict && !reasons.some((x) => /does not fit the policy/.test(x)) && (
                  <li className="crit">
                    <span className="sr">Conflict or risk:</span>
                    <div>{plain(`${proposal?.action} does not fit the policy: ${conflict.why}`)}.</div>
                  </li>
                )}
                {s.invoice && !s.invoice.containsInstructions && (
                  <li className="pass">
                    <span className="sr">Passed:</span>
                    <div>Invoice text was screened for hidden instructions. Passed.</div>
                  </li>
                )}
                {s.invoice?.containsInstructions && (
                  <li className="crit">
                    <span className="sr">Stopped:</span>
                    <div>Instructions were found in the invoice: {s.invoice.instructionsSummary || "unspecified"}.</div>
                  </li>
                )}
                {proposal?.fraudFlag && (
                  <li className="crit">
                    <span className="sr">Stopped:</span>
                    <div>Possible fraud: {proposal.fraudReason || "flagged by the agent"}.</div>
                  </li>
                )}
              </ul>
              {writes.length > 0 && (
                <>
                  <h3 className="lab sub-h">Writes to the ERP</h3>
                  <ul className="rules">
                    {writes.map((w) => (
                      <WriteLine key={`${w.ref}@${w.at}`} w={w} />
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="panel card" aria-labelledby="run-h">
              <h2 id="run-h" className="lab">
                This Run
              </h2>
              <dl className="kv">
                {seconds != null && (
                  <>
                    <dt>Time to proposal</dt>
                    <dd>{duration(seconds)}</dd>
                  </>
                )}
                <dt>Tool calls</dt>
                <dd>{calls.length}</dd>
                <dt>Model cost</dt>
                <dd>{usd(cost, 4)}</dd>
                <dt>Proposal drafts</dt>
                <dd>{s.draftVersion ?? 0}</dd>
                {(decision?.sentBack ?? 0) > 0 && (
                  <>
                    <dt>Sent back</dt>
                    <dd>{decision!.sentBack} {decision!.sentBack === 1 ? "time" : "times"}</dd>
                  </>
                )}
                {Number(s.round ?? 1) > 1 && (
                  <>
                    <dt>Match rounds</dt>
                    <dd>{s.round}</dd>
                  </>
                )}
                {s.reviewer && (
                  <>
                    <dt>Reviewed by</dt>
                    <dd>{s.reviewer}</dd>
                  </>
                )}
              </dl>
              {Object.keys(s.skillVersions ?? {}).length > 0 && (
                <>
                  <h3 className="lab sub-h">
                    <Term term="Skill">Skills</Term> Used
                  </h3>
                  <ul className="skill-list">
                    {Object.entries((s.skillVersions ?? {}) as Record<string, string>).map(([n, v]) => (
                      <li key={n}>
                        {titleCase(n)} <span className="muted">version {v}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {summary.temporalStatus === "RUNNING" && s.stage === "waiting" && (
              <form
                className="panel card"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (recheck.busy) return;
                  setRecheck({ busy: true });
                  postJson(`/api/cases/${summary.workflowId}/recheck`, { reason })
                    .then(() => {
                      setReason("");
                      setRecheck({ sent: true });
                      onChanged();
                    })
                    .catch((err: Error) => setRecheck({ error: err.message }));
                }}
              >
                <label htmlFor="steer" className="lab">
                  Ask the Case to Re-check Now
                </label>
                <div className="steer">
                  <input id="steer" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The receipt for this PO was posted this morning" />
                  <button type="submit" className="btn" disabled={!reason.trim() || recheck.busy}>
                    {recheck.busy ? "Sending…" : "Request Re-check"}
                  </button>
                </div>
                {recheck.error && (
                  <span className="form-error" role="alert">
                    The re-check was not requested: {recheck.error}. Your text is kept; try again.
                  </span>
                )}
                {recheck.sent && (
                  <span className="muted" role="status">
                    Re-check requested. The case matches the invoice again now instead of waiting for the daily check.
                  </span>
                )}
              </form>
            )}
          </div>
        </div>

        <details className="panel audit" id="audit">
          <summary>
            Audit Trail · {calls.length} Tool Calls, Skills, Cost and Guardrails
          </summary>
          <Inspector state={s} />
        </details>
      </main>

      {summary.needsPerson && (
        <ReviewBar
          key={`${summary.workflowId}/${s.draftVersion}`}
          workflowId={summary.workflowId}
          me={me}
          approveLabel={approveLabel}
          ifApprove={ifApprove}
          ifSendBack={sendBackEffect(agent.name, Number(s.draftVersion ?? 1))}
          ifEscalate={escalateEffect(summary.ref)}
          conflictHint={conflict ? plain(`${conflict.expected ? `The policy points to ${titleCase(conflict.expected)}: ` : ""}${conflict.why ?? "the proposed action does not fit the policy"}.`) : undefined}
          approveNote
          sendBackPresets={[
            ...(conflict?.expected ? [`Propose ${titleCase(conflict.expected)}, which the policy points to`] : []),
            "Check the contract price in effect on the invoice date",
            "Cite the evidence for every figure",
            "Confirm the quantity received",
          ]}
          approveFacts={[
            ["Action", actionLabel],
            ...(amount ? ([["Amount", cents(Math.abs(amount))]] as Array<[string, string]>) : []),
            ...(route?.path === "post" && s.adjustment?.payableCents != null ? ([["Invoice Payable After", cents(s.adjustment.payableCents)]] as Array<[string, string]>) : []),
            ["Case", summary.ref],
            ...(invNo ? ([["Vendor Invoice", invNo]] as Array<[string, string]>) : []),
          ]}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function Option({ kind, action, text, verdict, quoted }: { kind: string; action: string; text?: string; verdict?: "fits" | "conflict"; quoted?: boolean }) {
  return (
    <div className={`opt${verdict === "fits" ? " fits" : verdict === "conflict" ? " conflict" : ""}`}>
      <span className="k">{kind}</span>
      <b>{titleCase(action)}</b>
      <span className="t">{text ? (quoted ? `“${text}”` : `Policy: ${text}`) : ""}</span>
      <span className="v">{verdict === "fits" ? "✓ Fits" : verdict === "conflict" ? "✕ Does Not Fit" : ""}</span>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Bar({ base, over }: { base: number; over?: boolean }) {
  const b = Math.max(0, Math.min(100, base));
  return (
    <div className="t">
      <i style={{ width: `${b}%` }} />
      {over && <i className="v" style={{ width: `${100 - b}%` }} />}
    </div>
  );
}

function ResearchCase({ detail, agent, me, onBack, onChanged }: CaseProps) {
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
  return (
    <>
      <main className="page" aria-labelledby="case-h">
        <div className="dh">
          <div className="row" style={{ alignItems: "center" }}>
            <span className={`tag ${tagClass}${summary.needsPerson ? " solid" : ""}`}>{summary.needsPerson ? "Needs Decision" : tagText}</span>
            <BackLink agent={agent} onBack={onBack} />
          </div>
          <h1 id="case-h">{summary.needsPerson ? `Approve the brief on “${question ?? "an unrecorded question"}”?` : (question ?? summary.title)}</h1>
          {!question && <p className="why">This run started before the portal kept the question; the brief is shown as written.</p>}
          {!summary.needsPerson && summary.reason && <p className="why">{plain(summary.reason)}.</p>}
          {deadline && (
            <p className="why deadline">
              <b>Decide within {until(deadline.expiresAt)}</b> (by {dateTime(deadline.expiresAt)}). {deadline.onExpiry}
            </p>
          )}
          <dl className="meta">
            <Fact k="Case" v={summary.ref || summary.workflowId} />
            <Fact k="Draft" v={`Version ${s.draftVersion ?? 0}`} />
            <Fact k="Sources" v={cov ? `${cov.cited.length} cited of ${cov.sources}` : String(sources.length)} />
            <Fact k="Model Cost" v={costText(summary)} />
          </dl>
        </div>
        <StepStrip steps={steps} />
        <div className="g2">
          <div className="gcol">
            <section className="panel card" aria-labelledby="draft-h">
              <h2 id="draft-h" className="lab">
                Draft {s.draftVersion ?? 0}
              </h2>
              {concerns.length > 0 && (
                <div className="gap crit" role="note">
                  <b>Check before approving.</b> {concerns.join(" ")}
                </div>
              )}
              <p className="rec" style={{ whiteSpace: "pre-wrap" }}>
                {s.draft?.summary ?? "No draft yet."}
              </p>
              {(s.draft?.keyPoints ?? []).length > 0 && (
                <>
                  <h3 className="lab sub-h">Key Points</h3>
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
            {sources.length > 0 && (
              <section className="panel card" aria-labelledby="src-h">
                <h2 id="src-h" className="lab">
                  Sources · {sources.length}
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
            )}
          </div>
          <div className="gcol">
            <section className="panel card" aria-labelledby="rrun-h">
              <h2 id="rrun-h" className="lab">
                This Run
              </h2>
              <dl className="kv">
                <dt>Question</dt>
                <dd>{question ?? "Not recorded"}</dd>
                <dt>Searches</dt>
                <dd>{(s.queries ?? []).length ? (s.queries as string[]).map((q) => `“${q}”`).join(", ") : "–"}</dd>
                <dt>Model cost</dt>
                <dd>{costText(summary)}</dd>
                {usage.map((u, i) => (
                  <Fragment key={i}>
                    <dt>{titleCase(u.step)}</dt>
                    <dd>
                      {u.model} · {usd(u.costUsd ?? 0, 4)}
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
          </div>
        </div>
      </main>
      {summary.needsPerson && (
        <ReviewBar
          workflowId={summary.workflowId}
          me={me}
          approveLabel="Approve Brief"
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
