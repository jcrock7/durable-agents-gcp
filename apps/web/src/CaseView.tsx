import { useState } from "react";
import { cents, caseTag, postJson, usd, type CaseDetail } from "./api.js";
import { Inspector } from "./Inspector.js";
import { Lock } from "./icons.js";

/** The selected case: proposal, evidence, the rule that applies, and the actions a person can take. */
export function CaseView({ detail, me, onChanged }: { detail: CaseDetail; me: string; onChanged: () => void }) {
  const { state } = detail;
  if (!state) {
    return (
      <section className="case-col">
        <div className="panel empty">This run has no state to show (it may have failed to start).</div>
      </section>
    );
  }
  return detail.agentId === "research-summarize" ? (
    <ResearchCase detail={detail} me={me} onChanged={onChanged} />
  ) : (
    <>
      <InvoiceCase detail={detail} me={me} onChanged={onChanged} />
      <Inspector state={state} />
    </>
  );
}

function ReviewBar({ workflowId, me, approveLabel, onChanged }: { workflowId: string; me: string; approveLabel: string; onChanged: () => void }) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const send = async (approved: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await postJson(`/api/cases/${workflowId}/review`, approved ? { approved } : { approved, feedback });
      setFeedback("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="actions">
      <button type="button" className="btn primary" disabled={busy} onClick={() => void send(true)}>
        {approveLabel}
      </button>
      <label htmlFor="feedback" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Feedback for the agent
      </label>
      <textarea id="feedback" className="feedback" rows={1} placeholder="Feedback to send it back, e.g. Ask for a credit memo instead" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <button type="button" className="btn" disabled={busy || !feedback.trim()} onClick={() => void send(false)}>
        Send back
      </button>
      <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
        as {me}
      </span>
      {error && <span style={{ flexBasis: "100%", color: "var(--warn)", fontSize: 13 }}>{error}</span>}
    </div>
  );
}

function InvoiceCase({ detail, me, onChanged }: { detail: CaseDetail; me: string; onChanged: () => void }) {
  const { summary } = detail;
  const s = detail.state!;
  const [tagClass, tagText] = caseTag(summary);
  const proposal = s.proposal;
  const evidence: Array<Record<string, any>> = s.evidence ?? [];
  const cited = new Set<string>(proposal?.citedEvidence ?? []);
  const route = s.route;
  const gateClass = s.status === "resolved" ? "ok" : route?.needsPerson || route?.path === "escalate" || s.status === "blocked" ? "warn" : "info";
  const gateText =
    s.status === "blocked" || s.status === "escalated"
      ? `${s.status === "blocked" ? "Blocked" : "Escalated to a person"}, invoice held: ${(s.reasons ?? []).join("; ")}`
      : route?.path === "escalate"
        ? `Goes to a person, invoice held: ${route.reasons.join("; ")}`
        : route?.needsPerson
          ? `${s.reviewer ? `Approved by ${s.reviewer}.` : "Approval required:"} ${route.reasons.join("; ")}`
          : route
            ? `No approval needed: within policy. Path: ${route.path}.`
            : "The agent is still working on this case.";
  const cost = (s.usage ?? []).reduce((sum: number, u: Record<string, number>) => sum + (u.costUsd ?? 0), 0);
  const [reason, setReason] = useState("");

  return (
    <section className="case-col" aria-labelledby="case-h">
      <div className="panel">
        <div className="case-head">
          <div style={{ minWidth: 0 }}>
            <h2 id="case-h">{summary.title}</h2>
            <div className="mono muted" style={{ fontSize: 12, marginTop: 3 }}>
              {summary.workflowId} · {s.exceptionId} · round {s.round}
              {Object.keys(s.skillVersions ?? {}).length ? ` · ${Object.entries(s.skillVersions).map(([n, v]) => `${n} v${v}`).join(", ")}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`tag ${tagClass}`}>{tagText}</span>
            <span className="chip mono">{usd(cost, 4)}</span>
          </div>
        </div>

        <dl className="facts">
          <div>
            <dt>Exception</dt>
            <dd>{(proposal?.exceptionType ?? s.match?.exceptionTypes?.join(", ") ?? "–").replace(/_/g, " ")}</dd>
          </div>
          <div>
            <dt>Action</dt>
            <dd className="mono" style={{ fontSize: 14 }}>
              {proposal?.action ?? "–"}
              {proposal ? <span className="muted" style={{ fontWeight: 400 }}> ({proposal.confidence})</span> : null}
            </dd>
          </div>
          <div>
            <dt>Amount (match-engine)</dt>
            <dd className="mono" style={{ fontSize: 14 }}>
              {cents(s.adjustment?.amountCents)}
            </dd>
          </div>
        </dl>

        <div className="body">
          <h3 className="section-title">Proposed resolution</h3>
          <p className="rationale">{proposal?.rationale ?? "No proposal yet."}</p>
          {proposal?.unconfirmed ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Not confirmed: {proposal.unconfirmed}
            </p>
          ) : null}

          {evidence.length > 0 && (
            <div className="table-box">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>Ref</th>
                    <th>Evidence</th>
                    <th>Source tool</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.map((e) => (
                    <tr key={e.ref} style={cited.has(e.ref) ? { background: "var(--accent-weak)" } : undefined}>
                      <td style={{ fontWeight: 600 }}>{e.ref}</td>
                      <td style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{String(e.excerpt).slice(0, 280)}</td>
                      <td className="mono muted" style={{ fontSize: 12 }}>
                        {e.source}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={`gate ${gateClass}`}>
            <Lock />
            <span>{gateText}</span>
          </div>
        </div>

        {summary.needsPerson && <ReviewBar workflowId={summary.workflowId} me={me} approveLabel={proposal?.action === "request_credit_memo" ? "Approve and send" : "Approve and post"} onChanged={onChanged} />}
      </div>

      {s.message && (
        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">Message queued</h3>
            <span className="muted mono" style={{ fontSize: 12 }}>
              to {s.message.to}
            </span>
          </div>
          <div className="body" style={{ lineHeight: 1.6 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Subject: {s.message.subject}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{s.message.body}</div>
          </div>
        </div>
      )}

      {summary.temporalStatus === "RUNNING" && (
        <form
          className="panel steer"
          onSubmit={(e) => {
            e.preventDefault();
            void postJson(`/api/cases/${summary.workflowId}/recheck`, { reason }).then(() => {
              setReason("");
              onChanged();
            });
          }}
        >
          <label htmlFor="steer" style={{ fontSize: 13, fontWeight: 600 }}>
            Tell the case to re-check
          </label>
          <input id="steer" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The receipt for this PO was posted this morning" />
          <button type="submit" className="btn" disabled={!reason.trim() || s.stage !== "waiting"} title={s.stage === "waiting" ? "" : "Only while the case waits for a receipt"}>
            Send
          </button>
        </form>
      )}
    </section>
  );
}

function ResearchCase({ detail, me, onChanged }: { detail: CaseDetail; me: string; onChanged: () => void }) {
  const { summary } = detail;
  const s = detail.state!;
  const [tagClass, tagText] = caseTag(summary);
  return (
    <section className="case-col" aria-labelledby="case-h">
      <div className="panel">
        <div className="case-head">
          <div>
            <h2 id="case-h">{summary.title}</h2>
            <div className="mono muted" style={{ fontSize: 12, marginTop: 3 }}>
              {summary.workflowId} · draft {s.draftVersion ?? 0}
            </div>
          </div>
          <span className={`tag ${tagClass}`}>{tagText}</span>
        </div>
        <div className="body">
          <h3 className="section-title">Draft</h3>
          <p className="rationale" style={{ whiteSpace: "pre-wrap" }}>
            {s.draft?.summary ?? "No draft yet."}
          </p>
          {(s.sources ?? []).length > 0 && (
            <div className="table-box">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {s.sources.map((src: Record<string, string>) => (
                    <tr key={src.id}>
                      <td>{src.id}</td>
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
          )}
        </div>
        {summary.needsPerson && <ReviewBar workflowId={summary.workflowId} me={me} approveLabel="Approve brief" onChanged={onChanged} />}
      </div>
    </section>
  );
}
