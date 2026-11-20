import { Fragment, useState, type ReactNode } from "react";
import { cents, caseTag, plain, postJson, shortDate, sourceLabel, titleCase, usd, type Agent, type AnyState, type CaseDetail } from "./api.js";
import { Inspector } from "./Inspector.js";

/**
 * The actions of the ap-resolution-policy skill, version 1.3 (agents/general/invoice-exception-resolver/skills).
 * Shown beside a proposal so a reviewer can check the action against the policy. Only used when the run recorded
 * that version; the API does not serve skill text yet.
 */
const POLICY_VERSION = "1.3";
const POLICY: Record<string, { when: string; effect: string }> = {
  accept_variance: { when: "The invoiced price is the contract price in effect on the invoice date, for example a documented price change after the PO was issued.", effect: "Pay as invoiced. Always needs a person." },
  request_credit_memo: { when: "Billed above a contract price that is on file for the invoice date (and above the PO), with no change on record; or billed a charge the vendor's terms do not allow.", effect: "Hold the invoice and ask the vendor for a credit memo." },
  short_pay: { when: "Fewer units were received than invoiced, and nothing shows the rest is coming.", effect: "Pay for what was received; tell the vendor. Always needs a person." },
  wait_for_receipt: { when: "No receipt, and a shipment notice shows the goods are still in transit.", effect: "Hold and wait; the case re-checks daily." },
  request_receipt_entry: { when: "No receipt, but a proof of delivery shows the goods arrived.", effect: "Ask receiving to post the receipt, then wait." },
  accept_uom_conversion: { when: "Billed by the case against a PO in units, and the converted amounts agree.", effect: "Pay as invoiced." },
  accept_charge: { when: "A charge not on the PO that the vendor's terms allow, within the cap.", effect: "Pay as invoiced." },
  reject_duplicate: { when: "The same invoice was already paid.", effect: "Do not pay; tell the vendor. Always needs a person." },
  reassign_po: { when: "The invoice cites the wrong PO and one open PO fits its lines.", effect: "Ask the buyer to confirm, record the correct PO." },
  escalate: { when: "The evidence does not settle the case, the evidence conflicts, or a fraud flag applies.", effect: "Hold and hand to an AP specialist." },
};

/** The selected case as a page: the decision first, then the agent's work, the numbers, the evidence and the audit trail. */
export function CaseView({ detail, agent, me, onBack, onChanged }: { detail: CaseDetail; agent: Agent; me: string; onBack: () => void; onChanged: () => void }) {
  if (!detail.state) {
    return (
      <main className="page">
        <div className="panel empty">This run has no state to show (it may have failed to start).</div>
      </main>
    );
  }
  return detail.agentId === "research-summarize" ? <ResearchCase detail={detail} me={me} onChanged={onChanged} /> : <InvoiceCase detail={detail} agent={agent} me={me} onBack={onBack} onChanged={onChanged} />;
}

function ReviewBar(props: { workflowId: string; me: string; approveLabel: string; ifApprove: string; ifSendBack: string; onChanged: () => void }) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const send = async (approved: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await postJson(`/api/cases/${props.workflowId}/review`, approved ? { approved } : { approved, feedback });
      setFeedback("");
      props.onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dbar">
      <div className="what">
        <b>If you approve:</b> {props.ifApprove} <b>If you send back:</b> {props.ifSendBack}
      </div>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void send(true)}>
        {props.approveLabel}
      </button>
      <label htmlFor="feedback" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Feedback for the agent
      </label>
      <textarea id="feedback" className="feedback" rows={1} placeholder="Or tell the agent what to do instead, e.g. ask for a credit memo" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <button type="button" className="btn" disabled={busy || !feedback.trim()} title={feedback.trim() ? "" : "Write feedback for the agent first"} onClick={() => void send(false)}>
        Send Back to Agent
      </button>
      <span className="who">Recorded as {props.me}</span>
      {error && <span style={{ flexBasis: "100%", color: "var(--warn)" }}>{error}</span>}
    </div>
  );
}

/** Pull one field out of a JSON-looking excerpt, even when the excerpt was cut short. */
function field(raw: string, key: string): string | undefined {
  const m = new RegExp(`"${key}"\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"?|(-?[\\d.]+))`).exec(raw);
  return m ? (m[1] ?? m[2])?.replace(/\\n/g, " ").replace(/\\"/g, '"') : undefined;
}
const line = (raw: string, label: RegExp) => label.exec(raw)?.[1]?.trim();

/** A sentence a controller can check, in place of the raw tool output. */
function describe(e: AnyState): { title: string; body: string } {
  const raw = String(e.excerpt ?? "");
  const src = sourceLabel(e.source);
  if (/^\(no rows\)$/i.test(raw.trim())) return { title: src, body: "The search returned nothing." };
  if (String(e.source).startsWith("docs:")) {
    const no = line(raw, /Invoice number:\s*(.+)/i);
    const parts = [
      line(raw, /Invoice date:\s*(.+)/i) && `Dated ${shortDate(line(raw, /Invoice date:\s*(.+)/i))}`,
      line(raw, /Customer PO:\s*(.+)/i),
      line(raw, /Due date:\s*(.+)/i) && `due ${shortDate(line(raw, /Due date:\s*(.+)/i))}`,
    ].filter(Boolean);
    return { title: no ? `Invoice ${no}` : src, body: parts.length ? `${parts.join(", ")}. From ${raw.split("\n")[0]}.` : raw.slice(0, 200) };
  }
  if (raw.trim().startsWith("{") || raw.trim().startsWith("[")) {
    const price = field(raw, "price_cents");
    if (price) {
      const to = field(raw, "effective_to");
      return { title: "Contract Price", body: `${field(raw, "item_id") ?? "Item"} at ${cents(Number(price))}, effective ${shortDate(field(raw, "effective_from"))}${to ? ` to ${shortDate(to)}` : ", no end date"}.` };
    }
    const subject = field(raw, "subject");
    if (subject) {
      const body = field(raw, "body");
      return { title: `Vendor Message, ${shortDate(field(raw, "sent_at"))}`, body: `“${subject}” from ${field(raw, "from_address") ?? "unknown sender"}.${body ? ` ${body.slice(0, 180)}${body.length > 180 ? "…" : ""}` : ""}` };
    }
    return { title: src, body: raw.slice(0, 200) };
  }
  return { title: String(e.source).startsWith("match-engine") ? "Three-Way Match" : src, body: plain(raw.replace(/^[A-Z_]+:\s*/, "")) };
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

const stamp = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

function InvoiceCase({ detail, agent, me, onBack, onChanged }: { detail: CaseDetail; agent: Agent; me: string; onBack: () => void; onChanged: () => void }) {
  const { summary } = detail;
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
  const [step, setStep] = useState<number | null>(null);
  const sel = step ?? timeline.length - 1;

  // Header facts. Vendor and due date are only on the invoice PDF text today, so they are read from that evidence.
  const pdf = String(evidence.find((e) => String(e.source).startsWith("docs:"))?.excerpt ?? "");
  const vendor = pdf.split("\n")[0]?.trim() || undefined;
  const due = line(pdf, /Due date:\s*(.+)/i);
  const invNo: string | undefined = s.invoice?.vendorInvoiceNumber;
  const exception = (proposal?.exceptionType ?? s.match?.exceptionTypes?.[0] ?? "exception").replace(/_/g, " ");
  const amount: number | undefined = s.adjustment?.amountCents;
  const subject = `${vendor ? `${vendor} ` : ""}invoice ${invNo ?? summary.ref}`;
  const actionLabel = titleCase(proposal?.action);
  const headline = !summary.needsPerson
    ? `${titleCase(exception)} on ${subject}`
    : proposal?.action === "accept_variance" && amount != null
      ? `Approve a ${cents(amount)} ${exception} on ${subject}?`
      : `Approve “${actionLabel}” for the ${exception} on ${subject}?`;

  // The numbers, from the match engine's finding.
  const finding: AnyState | undefined = (s.match?.findings ?? []).find((f: AnyState) => f.details?.invoicedUnitPriceCents != null && f.details?.poUnitPriceCents != null);
  const d = finding?.details;
  const unitGap = d ? d.invoicedUnitPriceCents - d.poUnitPriceCents : 0;
  const qty = d && unitGap > 0 && finding?.amountCents ? finding.amountCents / unitGap : null;
  const wholeQty = qty != null && Math.abs(qty - Math.round(qty)) < 0.01 ? Math.round(qty) : null;
  const basePct = d ? (100 * d.poUnitPriceCents) / d.invoicedUnitPriceCents : 0;
  const overPct = d && d.poUnitPriceCents ? (100 * unitGap) / d.poUnitPriceCents : 0;

  // Why a person: the rules that fired, with the approval line drawn when one of them is the threshold.
  const reasons: string[] = route?.reasons ?? s.reasons ?? [];
  const line$ = reasons.map((r) => /amount (\d+(?:\.\d+)?) is over the (\d+(?:\.\d+)?) approval line/.exec(r)).find(Boolean);
  const over = line$ ? { amount: Number(line$[1]), limit: Number(line$[2]) } : null;
  const scale = over ? Math.max(over.amount * 1.1, over.limit * 1.5) : 1;
  const routing =
    s.status === "blocked" || s.status === "escalated"
      ? `${s.status === "blocked" ? "Blocked" : "Escalated to a person"}. The invoice is held.`
      : route?.path === "escalate"
        ? "Goes to a person. The invoice is held."
        : route?.needsPerson
          ? s.reviewer
            ? `Approved by ${s.reviewer}.`
            : null
          : route
            ? "No approval needed: within policy."
            : "The agent is still working on this case.";

  const proposedAt = timeline.find((t) => /propose/i.test(t.name))?.at;
  const seconds = proposedAt && timeline[0] ? Math.round((Date.parse(proposedAt) - Date.parse(timeline[0].at)) / 1000) : null;
  const policy = s.skillVersions?.["ap-resolution-policy"] === POLICY_VERSION && proposal?.action ? POLICY[proposal.action] : undefined;

  const stepTitle = (t: AnyState, i: number) =>
    i === 0 && /^match$/i.test(t.name) && s.match?.exceptionTypes?.length
      ? `${titleCase(s.match.exceptionTypes[0])} Found`
      : /^route$/i.test(t.name)
        ? "Checked Rules"
        : t.state === "now" && summary.needsPerson
          ? "Your Decision"
          : titleCase(t.name);
  const stepResult = (t: AnyState, i: number) =>
    i === 0 && finding && d
      ? `Three-way match: line ${finding.lineNo} billed at ${cents(d.invoicedUnitPriceCents)} a unit; PO says ${cents(d.poUnitPriceCents)}`
      : /^route$/i.test(t.name)
        ? reasons.length
          ? `${reasons.length} ${reasons.length === 1 ? "rule requires" : "rules require"} a person`
          : "Within policy"
        : t.state === "now" && summary.needsPerson
          ? "Nothing posts until you approve"
          : plain(String(t.detail ?? "").replace(/^exception:\s*/i, ""));
  const selected = timeline[sel];
  const from = sel > 0 ? Date.parse(timeline[sel - 1]!.at) : -Infinity;
  const stepCalls = selected ? calls.filter((c) => Date.parse(c.at) > from && Date.parse(c.at) <= Date.parse(selected.at)) : [];
  const stepUsage = selected ? usage.filter((u) => String(selected.name).toLowerCase().includes(String(u.step).toLowerCase().split(" ")[0]!)) : [];

  const approveLabel = proposal?.action === "request_credit_memo" ? "Approve and Send" : "Approve and Post to ERP";
  const ifApprove =
    route?.path === "post"
      ? `“${actionLabel}”${amount != null ? ` for ${cents(amount)}` : ""} is written to the ERP and the exception on invoice ${summary.ref} is marked ${plain(route.invoiceStatus ?? "resolved").toLowerCase()}.`
      : s.message
        ? `the queued message is sent to ${s.message.to} and the case follows the “${actionLabel}” path.`
        : `the case follows the “${actionLabel}” path.`;
  const ifSendBack = `nothing is written. The case returns to the ${agent.name} agent, which reworks its proposal using your feedback and brings round ${Number(s.round ?? 1) + 1} back to you.`;

  return (
    <>
      <main className="page" aria-labelledby="case-h">
        <div className="dh">
          <div className="row" style={{ alignItems: "center" }}>
            <span className={`tag ${tagClass}${summary.needsPerson ? " solid" : ""}`}>{summary.needsPerson ? `Needs Your Decision · Waiting ${ageOf(timeline, summary.startedAt)}` : tagText}</span>
            <button type="button" className="link-btn" onClick={onBack}>
              ‹ All {agent.name} Cases
            </button>
          </div>
          <h1 id="case-h">{headline}</h1>
          <dl className="meta">
            {vendor && <Fact k="Vendor" v={vendor} />}
            {invNo && <Fact k="Vendor Invoice" v={invNo} />}
            {s.invoice?.totalDue && <Fact k="Invoice Total" v={s.invoice.totalDue} />}
            {s.invoice?.poReference && <Fact k="Purchase Order" v={s.invoice.poReference} />}
            {s.invoice?.invoiceDate && <Fact k="Invoice Date" v={shortDate(s.invoice.invoiceDate)} />}
            {due && <Fact k="Due" v={shortDate(due)} />}
            <Fact k="Case" v={summary.ref} />
          </dl>
        </div>

        {timeline.length > 0 && (
          <div className="steps-wrap">
            <ol className="steps">
              {timeline.map((t, i) => (
                <li key={i}>
                  <button type="button" className={`step${t.state === "now" ? " now" : ""}${i === sel ? " sel" : ""}`} aria-pressed={i === sel} onClick={() => setStep(i)}>
                    <span className="n">
                      <i>{t.state === "now" ? i + 1 : "✓"}</i>
                      {t.state === "now" ? "Now" : i === 0 ? stamp(t.at) : `+${Math.round((Date.parse(t.at) - Date.parse(timeline[0]!.at)) / 1000)}s`}
                    </span>
                    <b>{stepTitle(t, i)}</b>
                    <span className="r">{stepResult(t, i)}</span>
                  </button>
                </li>
              ))}
            </ol>
            {selected && (
              <div className="panel sdw" aria-live="polite">
                <div className="row hd">
                  <b>
                    Step {sel + 1} · {stepTitle(selected, sel)}
                  </b>
                  <span>Select any step above to see what the agent did</span>
                </div>
                <div className="sd">
                  <div>
                    <span className="lab">What Ran</span>
                    {stepCalls.length ? (
                      stepCalls.map((c, i) => (
                        <span key={i}>
                          {sourceLabel(c.ref)} <span className="muted">· {c.outcome}, {c.durationMs} ms</span>
                        </span>
                      ))
                    ) : (
                      <span>{/^route$/i.test(selected.name) ? "The workflow checked the proposal against fixed rules. The model cannot override them." : selected.state === "now" ? "The run is paused. It resumes from here when a person decides." : "A model step with no tool calls."}</span>
                    )}
                  </div>
                  <div>
                    <span className="lab">{/^route$/i.test(selected.name) || selected.state === "now" ? "Rules" : "Recorded"}</span>
                    {/^route$/i.test(selected.name) || selected.state === "now" ? reasons.length ? reasons.map((r) => <span key={r}>{plain(r)}.</span>) : <span>No rule required a person.</span> : <span>{stamp(selected.at)}{stepUsage.length ? ` · model cost ${usd(stepUsage.reduce((a, u) => a + (u.costUsd ?? 0), 0), 4)}` : ""}</span>}
                  </div>
                  <div>
                    <span className="lab">Result</span>
                    <span>{selected.state === "now" && summary.needsPerson ? "Nothing is written to the ERP until you approve." : plain(String(selected.detail ?? "")) || "Done."}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="g2">
          <div className="gcol">
            {d && (
              <section className="panel card" aria-labelledby="num-h">
                <h2 id="num-h" className="lab">
                  The Numbers · Line {finding!.lineNo}
                  {wholeQty ? ` · ${wholeQty} Units` : ""}
                </h2>
                <div className="big">
                  <b>{cents(finding!.amountCents)}</b>
                  <span>{overPct.toFixed(1)}% over the purchase order</span>
                </div>
                <div className="bars">
                  {wholeQty != null && (
                    <>
                      <div className="lab sub">Line Total</div>
                      <span>Purchase order</span>
                      <Bar base={basePct} />
                      <span className="amt">{cents(wholeQty * d.poUnitPriceCents)}</span>
                      <span>Invoiced</span>
                      <Bar base={basePct} over />
                      <span className="amt">{cents(wholeQty * d.invoicedUnitPriceCents)}</span>
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
                  <span className="tag info">
                    {actionLabel} · {titleCase(proposal.confidence)} Confidence
                  </span>
                )}
              </div>
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
              {policy && (
                <div className="pol">
                  <div className="ph">
                    AP Resolution Policy {POLICY_VERSION} · {actionLabel}
                  </div>
                  <p>
                    <span>Use when</span>
                    <span>{policy.when}</span>
                  </p>
                  <p>
                    <span>Effect</span>
                    <span>{policy.effect}</span>
                  </p>
                </div>
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
                    const { title, body } = describe(e);
                    return (
                      <div key={e.ref}>
                        <div className="h">
                          <b>
                            <span className="cite">{e.ref}</span> {title}
                          </b>
                          <span className="src">{citedRefs.has(e.ref) ? sourceLabel(e.source).split(" · ")[0] : "Not cited"}</span>
                        </div>
                        <span>{body}</span>
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
                {reasons.map((r) => (
                  <li key={r}>
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

        <details className="panel audit">
          <summary>
            Audit Trail · {calls.length} Tool Calls, Skills, Cost and Guardrails
          </summary>
          <Inspector state={s} />
        </details>
      </main>

      {summary.needsPerson && <ReviewBar workflowId={summary.workflowId} me={me} approveLabel={approveLabel} ifApprove={ifApprove} ifSendBack={ifSendBack} onChanged={onChanged} />}
    </>
  );
}

function ageOf(timeline: AnyState[], startedAt: string): string {
  const since = Date.parse(timeline.find((t) => t.state === "now")?.at ?? startedAt);
  const m = Math.max(0, Math.round((Date.now() - since) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
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

function ResearchCase({ detail, me, onChanged }: { detail: CaseDetail; me: string; onChanged: () => void }) {
  const { summary } = detail;
  const s = detail.state!;
  const [tagClass, tagText] = caseTag(summary);
  return (
    <>
      <main className="page" aria-labelledby="case-h">
        <div className="dh">
          <div>
            <span className={`tag ${tagClass}${summary.needsPerson ? " solid" : ""}`}>{summary.needsPerson ? "Needs Your Decision" : tagText}</span>
          </div>
          <h1 id="case-h">{summary.needsPerson ? `Approve this research brief?` : summary.title}</h1>
          <dl className="meta">
            <Fact k="Case" v={summary.ref || summary.workflowId} />
            <Fact k="Draft" v={`Version ${s.draftVersion ?? 0}`} />
            <Fact k="Sources" v={String((s.sources ?? []).length)} />
          </dl>
        </div>
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
