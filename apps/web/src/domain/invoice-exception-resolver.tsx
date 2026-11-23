import { liveHash } from "../routes.js";
import { useState, type ReactNode } from "react";
import { ago, cents, caseTag, duration, dateTime, plain, postJson, shortDate, sourceLabel, titleCase, until, usd, usePoll, type AnyState, type PersonReason, type Skill } from "../api.js";
import { approveEffect, decisionOutcome, escalateEffect, sendBackEffect } from "../effects.js";
import { Inspector } from "../Inspector.js";
import { Term } from "../Glossary.js";
import { clock, StepStrip, stepTime, type Chapter, type Step } from "../StepStrip.js";
import { cited, type ActionProps, Fact, NextDecision, ReviewBar, WriteLine, type CaseProps } from "../CaseParts.js";
import { Mark, MarkLegend, SheetColumns, SheetHead } from "../sheet.js";
import { vocab } from "../vocab.js";

// The Invoice Resolver's case sheet: its domain layer (accounts payable words and layout), built from shared parts.
const POLICY_SKILL = "ap-resolution-policy";
const RELEVANCE: Record<string, [string, string]> = { supports: ["ok", "Supports"], contradicts: ["crit", "Contradicts"], not_applicable: ["idle", "Not Applicable"] };
const GROUP: Record<PersonReason["group"], string> = { policy: "Policy", risk: "Risk", evidence: "Evidence" };

export function InvoiceCase({ detail, agent, me, onChanged }: CaseProps) {
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
  // Non-breaking hyphens keep a reference such as SLS-88213 on one line in the headline.
  const nb = (id: string) => id.replace(/-/g, "‑");
  const subject = invNo ? `vendor invoice ${nb(invNo)}${vendor ? ` from ${vendor}` : ""}` : `case ${nb(summary.ref)}`;
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

  const v = vocab(agent);
  const layout = agent.layout?.case ?? { main: ["figures", "proposal", "sources", "message"], margin: ["legend", "stops", "run", "recheck"] };
  const lineTotals = d && qty != null;
  const blocks: Record<string, ReactNode> = {
    figures: d && (
      <section className="sec" aria-labelledby="num-h">
        <h2 id="num-h">
          {v.figures} · Line {finding!.lineNo}
          {(line?.description || qty != null) && <span className="sec-sub">{[line?.itemId, line?.description, qty != null ? `${qty} ${line?.uom ?? "units"}` : null].filter(Boolean).join(" · ")}</span>}
        </h2>
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Figure</th>
                <th className="num">Purchase Order</th>
                <th className="num">Invoiced</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Unit price</td>
                <td className="num">
                  {cents(d.poUnitPriceCents)}
                  <Mark k="recorded" />
                </td>
                <td className="num">
                  {cents(d.invoicedUnitPriceCents)}
                  <Mark k="recorded" />
                </td>
              </tr>
              {d.contractPriceCents != null && (
                <tr>
                  <td>Contract price on file</td>
                  <td className="num">
                    {cents(d.contractPriceCents)}
                    <Mark k="recorded" />
                  </td>
                  <td className="num" />
                </tr>
              )}
              {lineTotals && (
                <tr>
                  <td>Line total, {qty} {line?.uom ?? "units"}</td>
                  <td className="num">
                    {cents(qty! * d.poUnitPriceCents)}
                    <Mark k="totalled" />
                  </td>
                  <td className="num">
                    {cents(qty! * d.invoicedUnitPriceCents)}
                    <Mark k="totalled" />
                  </td>
                </tr>
              )}
              <tr className="sum">
                <td>
                  Variance <span className="sub">{overPct.toFixed(1)}% over the purchase order</span>
                </td>
                <td className="num" />
                <td className="num">
                  {cents(finding!.amountCents)}
                  <Mark k={detail.threshold ? "rule" : "recorded"} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    ),
    proposal: (
      <section className="sec" aria-labelledby="rec-h">
        <h2 id="rec-h">
          {v.proposal}
          {proposal && (
            <span className="sec-sub">
              {actionLabel} · {titleCase(proposal.confidence)} confidence{Number(s.draftVersion ?? 1) > 1 ? ` · draft ${s.draftVersion}` : ""}
            </span>
          )}
        </h2>
        {conflict && (
          <p className="gap crit" role="alert">
            <b>Conflicts with policy.</b> {plain(conflict.why)}.{conflict.expected ? ` The policy points to ${titleCase(conflict.expected)}.` : ""}
          </p>
        )}
        <p className={`rec${conflict ? " quiet" : ""}`}>{proposal?.rationale ? cited(proposal.rationale, v.citePrefix) : "No proposal yet."}</p>
        {proposal && (
          <p className="muted conf-note">
            <Term term="Confidence" /> is the agent’s own rating of its {v.sources.toLowerCase()}: high, medium or low. Low always goes to a person; at high or medium the routing rules decide.
          </p>
        )}
        {proposal?.unconfirmed ? (
          <p className="gap">
            <b>Not confirmed.</b> {proposal.unconfirmed}
          </p>
        ) : null}
        {s.citationsValid === false && (
          <p className="gap">
            <b>Citation check failed.</b> The proposal cites {v.sources.toLowerCase()} that does not exist.
          </p>
        )}

        {proposal && (fit || alternatives.length > 0 || rule(proposal.action)) && (
          <div className="opts" aria-labelledby="opts-h">
            <h3 id="opts-h">Options Weighed</h3>
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
            <summary>AP Resolution Policy {policy.version} · View Full Policy</summary>
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
    ),
    sources: evidence.length > 0 && (
      <section className="sec" aria-labelledby="ev-h">
        <h2 id="ev-h">
          {v.sources}
          <span className="sec-sub">
            {evidence.length} {evidence.length === 1 ? "item" : "items"} · {citedRefs.size} cited in the proposal
          </span>
        </h2>
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
    ),
    message: s.message && (
      <section className="sec" aria-labelledby="msg-h">
        <h2 id="msg-h">
          Message Queued <span className="sec-sub">To {s.message.to}</span>
        </h2>
        <div style={{ fontWeight: 600 }}>{s.message.subject}</div>
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{s.message.body}</div>
      </section>
    ),
    legend: <MarkLegend ruleName={v.ruleName} />,
    stops: (
      <section className="sec" aria-labelledby="why-h">
        <h2 id="why-h">{summary.needsPerson ? "Why This Is with You" : "Routing"}</h2>
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
                  {pr.rule && personReasons.length > 0 && (pr.kind === "policy_conflict" || pr.group !== "policy") && <span className="rule-text">Rule: {plain(r)}</span>}
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
            <h3>Writes to the ERP</h3>
            <ul className="rules">
              {writes.map((w) => (
                <WriteLine key={`${w.ref}@${w.at}`} w={w} />
              ))}
            </ul>
          </>
        )}
      </section>
    ),
    run: (
      <section className="sec" aria-labelledby="run-h">
        <h2 id="run-h">This Run</h2>
        <dl className="kv">
          <dt>Time to proposal</dt>
          <dd>
            {seconds != null ? duration(seconds) : "Not recorded"}
            <Mark k={seconds != null ? "recorded" : "absent"} />
          </dd>
          <dt>Tool calls</dt>
          <dd>
            {calls.length}
            <Mark k="totalled" />
          </dd>
          <dt>Model cost</dt>
          <dd>
            {usd(cost, 4)}
            <Mark k="totalled" />
          </dd>
          <dt>Proposal drafts</dt>
          <dd>
            {s.draftVersion ?? 0}
            <Mark k="recorded" />
          </dd>
          {(decision?.sentBack ?? 0) > 0 && (
            <>
              <dt>Sent back</dt>
              <dd>
                {decision!.sentBack} {decision!.sentBack === 1 ? "time" : "times"}
                <Mark k="recorded" />
              </dd>
            </>
          )}
          {Number(s.round ?? 1) > 1 && (
            <>
              <dt>Match rounds</dt>
              <dd>
                {s.round}
                <Mark k="recorded" />
              </dd>
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
            <h3>
              <Term term="Skill">Skills</Term> Used
            </h3>
            <ul className="skill-list">
              {Object.entries((s.skillVersions ?? {}) as Record<string, string>).map(([n, ver]) => (
                <li key={n}>
                  {titleCase(n)} <span className="muted">version {ver}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    ),
    recheck: summary.temporalStatus === "RUNNING" && s.stage === "waiting" && (
      <form
        className="sec"
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
        <h2>
          <label htmlFor="steer">Ask the Case to Re-check Now</label>
        </h2>
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
    ),
  };

  return (
    <>
      <main className="page" aria-labelledby="case-h">
        <div className="sheet">
          <SheetHead
            title={<span id="case-h">{headline}</span>}
            prepared={
              deadline ? (
                <span className="deadline">
                  <b>Decide within {until(deadline.expiresAt)}</b> (by {dateTime(deadline.expiresAt)}). {deadline.onExpiry}
                </span>
              ) : !summary.needsPerson && !outcome && summary.reason ? (
                `${plain(summary.reason)}.`
              ) : (
                "Prepared by the run · decided by a person"
              )
            }
            refLine={`${v.case} ${summary.ref}`}
            refSub={
              <>
                <span className={`tag ${summary.needsPerson && conflict ? "crit" : tagClass}${summary.needsPerson ? " solid" : ""}`}>{summary.needsPerson ? `Needs Decision${conflict ? " · Conflicts with Policy" : ""} · Waiting ${waited}` : tagText}</span>
                {summary.overridden && <span className="tag warn">Approved Against Policy</span>}
              </>
            }
          />
          <dl className="meta">
            {vendor && <Fact k={v.counterparty} v={vendor} />}
            {invNo && <Fact k="Vendor Invoice" v={invNo} />}
            {s.invoice?.totalDue && <Fact k="Invoice Total" v={s.invoice.totalDue} mark="recorded" />}
            {s.invoice?.poReference && <Fact k="Purchase Order" v={s.invoice.poReference} />}
            {s.invoice?.invoiceDate && <Fact k="Invoice Date" v={shortDate(s.invoice.invoiceDate)} />}
            {facts?.dueDate && <Fact k="Due" v={shortDate(facts.dueDate)} />}
          </dl>

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

          <SheetColumns layout={layout} blocks={blocks} />

          <details className="audit" id="audit">
            <summary>Audit Trail · {calls.length} Tool Calls, Skills, Cost and Guardrails</summary>
            <Inspector state={s} sourcesLabel={v.sources} caseWord={v.case} />
          </details>
        </div>
      </main>

      {summary.needsPerson && (
        <ReviewBar
          key={`${summary.workflowId}/${s.draftVersion}`}
          workflowId={summary.workflowId}
          me={me}
          approveLabel={approveLabel}
          specialist={v.specialist}
          sendBackHint={v.sendBackHint}
          escalateHint={v.escalateHint}
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
      <span className="v">{verdict === "fits" ? "Fits" : verdict === "conflict" ? "Does Not Fit" : ""}</span>
    </div>
  );
}


/** The Invoice Resolver's queue actions on its agent page. */
export function InvoiceActions({ agent, demoControls, temporalUiUrl, onNav, onRunning }: ActionProps) {
  const [queueMsg, setQueueMsg] = useState<{ text: string; workflowId?: string; error?: boolean }>();
  return (
      <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {queueMsg && (
          <span className={queueMsg.error ? "form-error inline" : "muted"} role={queueMsg.error ? "alert" : "status"} style={{ fontSize: 14 }}>
            {queueMsg.text}
            {queueMsg.workflowId && temporalUiUrl && (
              <>
                {" "}
                <a href={`${temporalUiUrl.replace(/\/$/, "")}/namespaces/default/workflows/${queueMsg.workflowId}`} target="_blank" rel="noreferrer">
                  Open the Queue Run in Temporal ↗
                </a>
              </>
            )}
          </span>
        )}
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            void postJson<{ workflowId: string }>(`/api/agents/${agent.id}/queue`, { limit: 10 })
              .then((r) => {
                setQueueMsg({ text: "Started the queue run. Its cases appear under Running as each one starts.", workflowId: r.workflowId });
                onRunning();
              })
              .catch((e: Error) => setQueueMsg({ text: `The queue run did not start: ${e.message}.`, error: true }))
          }
        >
          Work the Next 10 Exceptions
        </button>
        {demoControls && (
          <button
            type="button"
            className="btn sm"
            title="Clone the demo price-variance invoice and watch the agent work it live"
            onClick={() =>
              void postJson<{ workflowId: string }>("/api/demo/sample-case", {})
                .then((r) => onNav(liveHash(agent.id, r.workflowId)))
                .catch((e: Error) => setQueueMsg({ text: `The sample case did not start: ${e.message}.`, error: true }))
            }
          >
            ▶ Run a Sample Invoice
          </button>
        )}
      </span>
  );
}
