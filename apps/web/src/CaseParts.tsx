import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { caseHash } from "./routes.js";
import { postJson, usePoll, type Agent, type CaseDetail, type CasePage, type WriteRecord } from "./api.js";
import { Close } from "./icons.js";
import { Mark, type MarkKind } from "./sheet.js";

/** Shared case-page parts. No domain words here: every label comes from the agent vocabulary or a prop (docs/design/agent-portal/agent-screen-guidelines.md). */
export type CaseProps = { detail: CaseDetail; agent: Agent; me: string; onBack: () => void; onChanged: () => void; onNav: (hash: string) => void };

/** What an agent page hands a domain's own queue actions. */
export type ActionProps = { agent: Agent; demoControls: boolean; temporalUiUrl?: string; onNav: (hash: string) => void; onRunning: () => void };

type Mode = "choose" | "approve" | "back" | "escalate";

export function ReviewBar(props: {
  workflowId: string;
  me: string;
  approveLabel: string;
  /** Who takes an escalated case, and the dialog hints, from the agent vocabulary. */
  specialist?: string;
  sendBackHint?: string;
  escalateHint?: string;
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
  const specialist = props.specialist ?? "Specialist";
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
        ? { title: "Send Back to Agent", effect: props.ifSendBack, label: "Feedback for the Agent", text: feedback, set: setFeedback, required: true, confirm: "Send Back to Agent", placeholder: props.sendBackHint ?? "Tell the agent what to do instead" }
        : mode === "escalate"
          ? { title: `Escalate to ${specialist}`, effect: props.ifEscalate ?? "", label: `Note for the ${specialist}`, text: note, set: setNote, required: true, confirm: "Confirm Escalation", placeholder: props.escalateHint ?? "What the specialist should check" }
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
        {props.ifEscalate && action("escalate", `Escalate to ${specialist}`, false)}
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

/** Rationale text with [E1, E2] references (the agent's citation prefix) turned into citation tags. */
export function cited(text: string, prefix = "E"): ReactNode[] {
  const p = prefix.replace(/[^A-Za-z]/g, "");
  return text.split(new RegExp(`(\\[${p}\\d+(?:\\s*,\\s*${p}\\d+)*\\])`, "g")).map((part, i) =>
    new RegExp(`^\\[${p}\\d`).test(part) ? (
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

export function BackLink({ agent }: { agent: Agent; onBack?: () => void }) {
  return (
    <a className="back-link" href={`#/agent/${agent.id}`}>
      ‹ All {agent.name} Cases
    </a>
  );
}

/** After a decision: the oldest other case waiting on a person, one click away. */
export function NextDecision({ current }: { current: string }) {
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

/** One write to a system of record and what allowed it. */
export function WriteLine({ w }: { w: WriteRecord }) {
  return (
    <li className={w.by === "person" ? "pass" : "note"}>
      <span className="sr">{w.by === "person" ? "Allowed by a person:" : "Allowed by a rule:"}</span>
      <div>
        <b>{w.label}.</b> {w.why}
      </div>
    </li>
  );
}

export function Fact({ k, v, mark }: { k: string; v: string; mark?: MarkKind }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>
        {v}
        {mark && <Mark k={mark} />}
      </dd>
    </div>
  );
}
