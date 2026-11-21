import { liveHash } from "./routes.js";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { cents, caseTag, plain, postJson, shortDate, sourceLabel, titleCase, usd, usePoll, type Agent, type AnyState, type CaseDetail, type Skill } from "./api.js";
import { approveEffect, decisionOutcome, escalateEffect, sendBackEffect } from "./effects.js";
import { Close } from "./icons.js";
import { Inspector } from "./Inspector.js";
import { clock, StepStrip, stepTime, type Step } from "./StepStrip.js";

const POLICY_SKILL = "ap-resolution-policy";
const RELEVANCE: Record<string, [string, string]> = { supports: ["ok", "Supports"], contradicts: ["crit", "Contradicts"], not_applicable: ["idle", "Not Applicable"] };

/** The selected case as a page: the decision first, then the agent's work, the numbers, the evidence and the audit trail. */
export function CaseView({ detail, agent, me, onBack, onChanged }: { detail: CaseDetail; agent: Agent; me: string; onBack: () => void; onChanged: () => void }) {
  if (!detail.state) {
    return (
      <main className="page">
        <div className="panel empty">{detail.summary.reason ?? "This run has no state to show (it may have failed to start)."}</div>
      </main>
    );
  }
  return detail.agentId === "research-summarize" ? <ResearchCase detail={detail} agent={agent} me={me} onBack={onBack} onChanged={onChanged} /> : <InvoiceCase detail={detail} agent={agent} me={me} onBack={onBack} onChanged={onChanged} />;
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
  /** What approving will write, shown in the approval dialog. */
  approveFacts?: Array<[string, string]>;
  /** Whether the workflow keeps a note with an approval. A conflict makes the reason required. */
  approveNote?: boolean;
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
  const action = (m: Mode, label: string, primary: boolean, first?: boolean) => (
    <button key={m} type="button" className={`btn${primary ? " primary" : ""}`} disabled={busy} aria-haspopup="dialog" data-first={first ? "" : undefined} onClick={() => setMode(m)}>
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
      <b>Recommended: send back.</b> {props.conflictHint} <b>If you approve anyway:</b> {props.ifApprove}
    </>
  ) : (
    <>
      <b>If you approve:</b> {props.ifApprove}
    </>
  );
  return (
    <section className="dbar" aria-label="Your decision">
      <div className="what">{lead}</div>
      <div className="dbar-actions">{actions()}</div>
      <button type="button" className="btn primary dbar-decide" disabled={busy} aria-haspopup="dialog" onClick={() => setMode("choose")}>
        Decide…
      </button>
      <span className="who">Recorded as {props.me}</span>
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
                <b>This conflicts with the policy.</b> {props.conflictHint}
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
              <button type="submit" className="btn primary" disabled={busy || !ready}>
                {busy ? "Sending…" : form.confirm}
              </button>
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
          .map((r) => (
            <Fragment key={r}>
              <span className="cite">{r}</span>{" "}
            </Fragment>
          ))}
      </Fragment>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function BackLink({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  return (
    <button type="button" className="link-btn" onClick={onBack}>
      ‹ All {agent.name} Cases
    </button>
  );
}

function InvoiceCase({ detail, agent, me, onBack, onChanged }: { detail: CaseDetail; agent: Agent; me: string; onBack: () => void; onChanged: () => void }) {
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

  const policyVersion: string | undefined = s.skillVersions?.[POLICY_SKILL];
  const policy = usePoll<Skill>(policyVersion ? `/api/agents/${agent.id}/skills/${POLICY_SKILL}?version=${encodeURIComponent(policyVersion)}` : null, 600_000).data;
  const rule = (action?: string) => policy?.actions.find((a) => a.action === action);

  const vendor = facts?.vendorName;
  const invNo: string | undefined = s.invoice?.vendorInvoiceNumber;
  const exception = (proposal?.exceptionType ?? s.match?.exceptionTypes?.[0] ?? "exception").replace(/_/g, " ");
  const amount: number | undefined = s.adjustment?.amountCents;
  const subject = `${vendor ? `${vendor} ` : ""}invoice ${invNo ?? summary.ref}`;
  const actionLabel = titleCase(proposal?.action);
  const routeFit: { fits: boolean; expected?: string; why?: string } | undefined = s.route?.policyFit;
  const headline = !summary.needsPerson
    ? `${titleCase(exception)} on ${subject}`
    : routeFit && !routeFit.fits
      ? `The agent proposes ${actionLabel} for the ${amount != null ? `${cents(amount)} ` : ""}${exception} on ${subject}. ${routeFit.expected ? `The policy points to ${titleCase(routeFit.expected)}.` : "That does not fit the policy."}`
      : proposal?.action === "accept_variance" && amount != null
      ? `Approve a ${cents(amount)} ${exception} on ${subject}?`
      : `Approve “${actionLabel}” for the ${exception} on ${subject}?`;

  // The numbers: unit prices from the match engine's finding, quantity and item from the ERP line.
  const finding: AnyState | undefined = (s.match?.findings ?? []).find((f: AnyState) => f.details?.invoicedUnitPriceCents != null && f.details?.poUnitPriceCents != null);
  const d = finding?.details;
  const line = facts?.lines.find((l) => l.lineNo === finding?.lineNo);
  const qty = line?.quantity;
  const basePct = d ? (100 * d.poUnitPriceCents) / d.invoicedUnitPriceCents : 0;
  const overPct = d && d.poUnitPriceCents ? (100 * (d.invoicedUnitPriceCents - d.poUnitPriceCents)) / d.poUnitPriceCents : 0;

  // Why a person: the rules that fired, with the approval line drawn when one of them is the threshold.
  const reasons: string[] = route?.reasons ?? s.reasons ?? [];
  const lineMatch = reasons.map((r) => /amount (\d+(?:\.\d+)?) is over the (\d+(?:\.\d+)?) approval line/.exec(r)).find(Boolean);
  const over = lineMatch ? { amount: Number(lineMatch[1]), limit: Number(lineMatch[2]) } : null;
  const scale = over ? Math.max(over.amount * 1.1, over.limit * 1.5) : 1;
  const routing =
    s.status === "blocked" || s.status === "escalated"
      ? `${s.status === "blocked" ? "Blocked" : "Escalated to a person"}. The invoice is held.`
      : s.status === "on_hold"
        ? "On hold."
        : route?.path === "escalate"
          ? "Goes to a person. The invoice is held."
          : route?.needsPerson
            ? s.reviewer
              ? `Approved by ${s.reviewer}.`
              : null
            : route
              ? "No approval needed: within policy."
              : "The agent is still working on this case.";
  const closing: string[] = s.status ? (s.reasons ?? []).filter((r: string) => !reasons.includes(r)) : [];

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
              : plain(String(t.detail ?? "").replace(/^exception:\s*/i, "")),
      time: stepTime(timeline as Array<{ at: string; state?: string }>, i),
      now,
      detail: [
        {
          label: "What Ran",
          body: stepCalls.length ? (
            stepCalls.map((c, k) => (
              <span key={k}>
                {sourceLabel(c.ref)}{" "}
                <span className="muted">
                  · {c.outcome}, {c.durationMs} ms
                </span>
              </span>
            ))
          ) : (
            <span>{isRoute ? "The workflow checked the proposal against fixed rules. The model cannot override them." : now ? "The run is paused. It resumes from here when a person decides." : "A step with no tool calls."}</span>
          ),
        },
        {
          label: isRoute || now ? "Rules" : "Recorded",
          body:
            isRoute || now ? (
              reasons.length ? (
                reasons.map((r) => <span key={r}>{plain(r)}.</span>)
              ) : (
                <span>No rule required a person.</span>
              )
            ) : (
              <span>
                {clock(t.at)}
                {stepCost ? ` · model cost ${usd(stepCost, 4)}` : ""}
              </span>
            ),
        },
        { label: "Result", body: <span>{mine ? "Nothing is written to the ERP until you approve." : plain(String(t.detail ?? "")) || "Done."}</span> },
      ],
    };
  });

  const at = (name: RegExp) => timeline.find((t) => name.test(String(t.name)));
  const approvedStep = at(/^approved$/i);
  const postedStep = at(/^post resolution$/i);
  const escalatedStep = at(/^escalated by reviewer$/i);
  const outcome = decisionOutcome({
    actionLabel,
    ref: summary.ref,
    path: route?.path,
    amountCents: amount,
    payableCents: s.adjustment?.payableCents,
    status: s.status,
    reviewer: s.reviewer,
    approvedAt: approvedStep?.at,
    approvalReason: /reason: (.+)$/.exec(String(approvedStep?.detail ?? ""))?.[1],
    postedAt: postedStep?.at,
    escalationNote: escalatedStep ? String(escalatedStep.detail ?? "") : undefined,
  });
  const writes = calls.filter((c) => String(c.ref).startsWith("erp-write:") && c.outcome === "ok").length;
  // A decided case opens on the step that carried the decision out, not on "Finished".
  const decidedStep = summary.needsPerson ? -1 : timeline.findIndex((t) => t === (postedStep ?? escalatedStep ?? approvedStep));

  const approveLabel = route?.path === "post" ? "Approve and Post to ERP" : route?.path === "hold" ? "Approve and Hold Invoice" : "Approve";
  const ifApprove = approveEffect({ actionLabel, ref: summary.ref, path: route?.path, amountCents: amount, payableCents: s.adjustment?.payableCents, messageTo: route?.message?.recipient });
  const waitingSince = Date.parse(timeline.find((t) => t.state === "now")?.at ?? summary.startedAt);
  const waitedMin = Math.max(0, Math.round((Date.now() - waitingSince) / 60000));
  const waited = waitedMin < 60 ? `${waitedMin}m` : `${Math.floor(waitedMin / 60)}h ${waitedMin % 60}m`;

  return (
    <>
      <main className="page" aria-labelledby="case-h">
        <div className="dh">
          <div className="row" style={{ alignItems: "center" }}>
            <span className={`tag ${summary.needsPerson && conflict ? "crit" : tagClass}${summary.needsPerson ? " solid" : ""}`}>{summary.needsPerson ? `Needs Your Decision${conflict ? " · Conflicts with Policy" : ""} · Waiting ${waited}` : tagText}</span>
            <BackLink agent={agent} onBack={onBack} />
          </div>
          <h1 id="case-h">{headline}</h1>
          {!summary.needsPerson && summary.reason && <p className="why">{plain(summary.reason)}.</p>}
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
            {writes > 0 && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  const el = document.getElementById("audit");
                  if (el instanceof HTMLDetailsElement) el.open = true;
                  el?.scrollIntoView({ block: "start" });
                }}
              >
                See the {writes === 1 ? "ERP Write" : `${writes} ERP Writes`} in the Audit Trail
              </button>
            )}
          </section>
        )}

        <StepStrip
          key={decidedStep}
          initial={decidedStep >= 0 ? decidedStep : undefined}
          steps={steps}
          action={{ label: summary.temporalStatus === "RUNNING" ? (summary.needsPerson || s.stage === "waiting" ? "Open Run View" : "Watch Live") : "Replay Run", href: liveHash(agent.id, summary.workflowId) }}
        />

        <div className="g2">
          <div className="gcol">
            {d && (
              <section className="panel card" aria-labelledby="num-h">
                <h2 id="num-h" className="lab">
                  {["The Numbers", `Line ${finding!.lineNo}`, line?.itemId, line?.description, qty != null ? `${qty} ${line?.uom ?? "Units"}` : null].filter(Boolean).join(" · ")}
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
                  Agent Recommendation
                </h2>
                {proposal && (
                  <span className={`tag ${conflict ? "crit" : "info"}`}>
                    {actionLabel} · {titleCase(proposal.confidence)} Confidence
                  </span>
                )}
              </div>
              {conflict && (
                <div className="gap crit" role="alert">
                  <b>Conflicts with policy.</b> {plain(conflict.why)}.{conflict.expected ? ` The policy points to ${titleCase(conflict.expected)}.` : ""}
                </div>
              )}
              <p className="rec">{proposal?.rationale ? cited(proposal.rationale) : "No proposal yet."}</p>
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
                <div className="opts" aria-label="Options">
                  <div className="lab">Options</div>
                  <Option kind="Agent proposed" action={proposal.action} text={rule(proposal.action)?.useWhen} verdict={fit ? (fit.fits ? "fits" : "conflict") : undefined} />
                  {conflict?.expected && <Option kind="Policy points to" action={conflict.expected} text={rule(conflict.expected)?.useWhen} verdict="fits" />}
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
                  {evidence.map((e) => {
                    const sum = detail.evidence?.[e.ref];
                    const title = sum?.title ?? sourceLabel(e.source);
                    const body = sum?.body ?? "No summary was recorded for this item. Open the raw output below.";
                    const rel = e.relevance ? RELEVANCE[e.relevance] : undefined;
                    return (
                      <div key={e.ref}>
                        <div className="h">
                          <b>
                            <span className="cite">{e.ref}</span> {title}
                          </b>
                          {rel ? <span className={`tag ${rel[0]}`}>{rel[1]}</span> : <span className="src">{citedRefs.has(e.ref) ? "Cited" : "Not cited"}</span>}
                        </div>
                        <span>{body}</span>
                        {e.relevanceNote && <span className="muted">Agent’s note: {e.relevanceNote}</span>}
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
              <ul className="rules">
                {routing && <li className="note">{routing}</li>}
                {closing.map((r) => (
                  <li key={r} className="note">
                    {plain(r)}.
                  </li>
                ))}
                {reasons.map((r) => (
                  <li key={r} className={/does not fit the policy/.test(r) ? "crit" : undefined}>
                    <div>
                      {plain(r)}.
                      {over && /approval line/.test(r) && (
                        <div className="meter">
                          <i style={{ width: `${Math.min(100, (100 * over.amount) / scale)}%` }} />
                          <u style={{ left: `${(100 * over.limit) / scale}%` }}>
                            <span>{cents(over.limit * 100)} line</span>
                          </u>
                          <s style={{ left: 0 }}>$0</s>
                          <s style={{ right: 0 }}>{cents(Math.round(scale) * 100)}</s>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
                {conflict && !reasons.some((r) => /does not fit the policy/.test(r)) && <li className="crit">{plain(`${proposal?.action} does not fit the policy: ${conflict.why}`)}.</li>}
                {s.invoice && !s.invoice.containsInstructions && <li className="pass">Invoice text was screened for hidden instructions. Passed.</li>}
                {s.invoice?.containsInstructions && <li>Instructions were found in the invoice: {s.invoice.instructionsSummary || "unspecified"}.</li>}
                {proposal?.fraudFlag && <li>Possible fraud: {proposal.fraudReason || "flagged by the agent"}.</li>}
              </ul>
            </section>

            <section className="panel card" aria-labelledby="run-h">
              <h2 id="run-h" className="lab">
                This Run
              </h2>
              <dl className="kv">
                {seconds != null && (
                  <>
                    <dt>Time to proposal</dt>
                    <dd>{seconds} seconds</dd>
                  </>
                )}
                <dt>Tool calls</dt>
                <dd>{calls.length}</dd>
                <dt>Model cost</dt>
                <dd>{usd(cost, 4)}</dd>
                <dt>Review round</dt>
                <dd>{s.round ?? 1}</dd>
                {s.reviewer && (
                  <>
                    <dt>Reviewed by</dt>
                    <dd>{s.reviewer}</dd>
                  </>
                )}
                {Object.entries((s.skillVersions ?? {}) as Record<string, string>).map(([n, v]) => (
                  <Fragment key={n}>
                    <dt>{titleCase(n)}</dt>
                    <dd>Version {v}</dd>
                  </Fragment>
                ))}
              </dl>
            </section>

            {summary.temporalStatus === "RUNNING" && s.stage === "waiting" && (
              <form
                className="panel card"
                onSubmit={(e) => {
                  e.preventDefault();
                  void postJson(`/api/cases/${summary.workflowId}/recheck`, { reason }).then(() => {
                    setReason("");
                    onChanged();
                  });
                }}
              >
                <label htmlFor="steer" className="lab">
                  Ask the Case to Re-check Now
                </label>
                <div className="steer">
                  <input id="steer" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The receipt for this PO was posted this morning" />
                  <button type="submit" className="btn" disabled={!reason.trim()}>
                    Request Re-check
                  </button>
                </div>
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
          ifSendBack={sendBackEffect(agent.name, Number(s.round ?? 1))}
          ifEscalate={escalateEffect(summary.ref)}
          conflictHint={conflict ? plain(`${conflict.expected ? `The policy points to ${titleCase(conflict.expected)}: ` : ""}${conflict.why ?? "the proposed action does not fit the policy"}.`) : undefined}
          approveNote
          approveFacts={[
            ["Action", actionLabel],
            ...(amount ? ([["Amount", cents(Math.abs(amount))]] as Array<[string, string]>) : []),
            ...(route?.path === "post" && s.adjustment?.payableCents != null ? ([["Invoice Payable After", cents(s.adjustment.payableCents)]] as Array<[string, string]>) : []),
            ["Invoice", `${summary.ref}${invNo ? ` (vendor’s number ${invNo})` : ""}`],
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

function ResearchCase({ detail, agent, me, onBack, onChanged }: { detail: CaseDetail; agent: Agent; me: string; onBack: () => void; onChanged: () => void }) {
  const { summary } = detail;
  const s = detail.state!;
  const [tagClass, tagText] = caseTag(summary);
  const timeline: AnyState[] = s.timeline ?? [];
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
        { label: "Sources So Far", body: <span>{(s.sources ?? []).length}</span> },
      ],
    };
  });
  return (
    <>
      <main className="page" aria-labelledby="case-h">
        <div className="dh">
          <div className="row" style={{ alignItems: "center" }}>
            <span className={`tag ${tagClass}${summary.needsPerson ? " solid" : ""}`}>{summary.needsPerson ? "Needs Your Decision" : tagText}</span>
            <BackLink agent={agent} onBack={onBack} />
          </div>
          <h1 id="case-h">{summary.needsPerson ? "Approve this research brief?" : summary.title}</h1>
          {!summary.needsPerson && summary.reason && <p className="why">{plain(summary.reason)}.</p>}
          <dl className="meta">
            <Fact k="Case" v={summary.ref || summary.workflowId} />
            <Fact k="Draft" v={`Version ${s.draftVersion ?? 0}`} />
            <Fact k="Sources" v={String((s.sources ?? []).length)} />
          </dl>
        </div>
        <StepStrip steps={steps} />
        <section className="panel card">
          <h2 className="lab">Draft</h2>
          <p className="rec" style={{ whiteSpace: "pre-wrap" }}>
            {s.draft?.summary ?? "No draft yet."}
          </p>
        </section>
        {(s.sources ?? []).length > 0 && (
          <section className="panel card">
            <h2 className="lab">Sources</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Ref</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {s.sources.map((src: Record<string, string>) => (
                    <tr key={src.id}>
                      <td>
                        <span className="cite">{src.id}</span>
                      </td>
                      <td>
                        <a href={src.url} target="_blank" rel="noreferrer">
                          {src.title}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
      {summary.needsPerson && (
        <ReviewBar
          workflowId={summary.workflowId}
          me={me}
          approveLabel="Approve Brief"
          ifApprove="the brief is marked approved and the run finishes."
          ifSendBack="the agent revises the draft using your feedback and brings a new version back to you."
          onChanged={onChanged}
        />
      )}
    </>
  );
}
