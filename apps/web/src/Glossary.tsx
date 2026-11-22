import { useEffect, useRef, useState, type ReactNode } from "react";
import { Close } from "./icons.js";

/** The portal's terms, in the words the pages use. Opened from the footer on every page, and from dotted terms in the text. */
const TERMS: Array<[string, string]> = [
  ["Case", "One invoice exception (or research question) an agent works from start to finish. “Case INV-20931” is the ERP's reference for the invoice."],
  ["Vendor invoice", "The vendor's own number for the invoice, such as SAL-4410, as printed on their PDF."],
  ["Demo invoice", "A copy of the seeded demo invoice, such as INV-20931-D3, with its own purchase order, goods receipt and PDF. Each Run a Sample Invoice works the next one."],
  ["Three-way match", "The check of an invoice against its purchase order and the goods receipt. A difference beyond the tolerance raises an exception."],
  ["Purchase order (PO)", "What was ordered, at what price. The invoice should bill what the PO says."],
  ["Goods receipt (GR)", "The record that the ordered goods arrived. An invoice is not paid against goods that were not received."],
  ["Approval line", "The amount above which a person must approve any write to the ERP. It is set in the agent's configuration."],
  ["Policy fit", "A fixed rule in the workflow checks the proposed action against the AP resolution policy. The model cannot override it."],
  ["Skill", "A versioned set of instructions the agent follows, such as the AP Resolution Policy. The case page shows the version each run used."],
  ["Send back", "Return the proposal to the agent with feedback. Nothing is written; the agent brings a new draft."],
  ["Escalate", "Hand the case to an AP specialist with a note. The invoice is put on hold so it is not paid meanwhile."],
  ["Protective hold", "A hold the rules place when a case ends with a specialist (blocked, escalated or expired), so the invoice is not paid while a person takes over."],
  ["Model tiers", "“fast” and “smart” are names at the model gateway. The gateway decides which model each one uses, and enforces the agent's budget."],
  ["Run view", "The case's workflow drawn live, or replayed once it has finished, with each step, tool call and engine event."],
  ["Engine history", "The record Temporal keeps of every step a run took. A run that loses its worker picks up from this record without repeating finished steps."],
  ["Worker", "A process that runs the agents' steps. Several run at once; if one stops, another continues the case."],
  ["Replay", "A finished run played back from its record. Long waits play short, so the replay is quicker than the run was."],
  ["Guardrail", "A fixed check that can stop a run: hidden instructions in a document, a tool outside the allow-list, or a budget."],
  ["Confidence", "The agent's own rating of its evidence: high, medium or low. Low always goes to a person."],
  ["Eval pass rate", "How often the agent chose the labelled answer on the test set of seeded cases, with the count and a link to the results."],
  ["Budget", "What the model gateway lets the agent spend in a period. It refuses calls beyond it."],
  ["Statuses", "Needs Decision: waiting on a person. Waiting: waiting on someone else, such as a goods receipt. On Hold: held so it is not paid. Escalated: with an AP specialist. Resolved: closed within the rules. Cancelled: the run was stopped before it finished."],
  ["Brief", "The Research Analyst's cited answer to a question, written from the sources it found. A person approves it or sends it back."],
  ["Draft", "One version of a proposal or brief. Sending it back makes the agent write the next draft."],
  ["Cited", "A source or evidence item the agent's text refers to, like [1] or E2. Not cited means it was gathered but not used."],
  ["Source check", "A fixed check on a research brief: it warns when every point rests on one source, or sources go uncited or are marked unrelated."],
  ["Override", "An approval a person gave against the policy check, with the reason they recorded. Marked on the case, in the queue and on the Overview."],
];

const slug = (term: string) => `gloss-${term.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-+$/, "")}`;
// Alphabetical, so a reader can scan for a word.
const SORTED = [...TERMS].sort(([a], [b]) => a.localeCompare(b));

/** A term in running text that opens the Glossary at its entry. */
export function Term({ term, children }: { term: string; children?: ReactNode }) {
  return (
    <button type="button" className="term" aria-haspopup="dialog" title={`What is ${term.toLowerCase()}? Opens the Glossary`} onClick={() => dispatchEvent(new CustomEvent("glossary", { detail: term }))}>
      {children ?? term}
    </button>
  );
}

export function Glossary() {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<string>();
  const [filter, setFilter] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const on = (e: Event) => {
      setFilter("");
      setAt((e as CustomEvent<string>).detail);
      setOpen(true);
    };
    addEventListener("glossary", on);
    return () => removeEventListener("glossary", on);
  }, []);
  // Open first, then move to the term: the entry can only scroll into view once the dialog is showing.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!open) {
      if (d.open) d.close();
      return;
    }
    if (!d.open) d.showModal();
    // A timeout, not an animation frame: it also runs in a background tab, and after the dialog has laid out.
    const t = setTimeout(() => {
      const el = at ? document.getElementById(slug(at)) : null;
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.focus({ preventScroll: true });
      }
    }, 30);
    return () => clearTimeout(t);
  }, [open, at]);
  const close = () => {
    setOpen(false);
    setAt(undefined);
  };
  const needle = filter.trim().toLowerCase();
  const shown = needle ? SORTED.filter(([t, d]) => t.toLowerCase().includes(needle) || d.toLowerCase().includes(needle)) : SORTED;
  return (
    <>
      <button type="button" className="link-btn foot-btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Glossary
      </button>
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="gloss-h"
        onClose={close}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
      >
        <div className="modal-body">
          <header>
            <h2 id="gloss-h">Glossary</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
              <Close />
            </button>
          </header>
          <label htmlFor="gloss-filter" className="sr">
            Find a term
          </label>
          <input id="gloss-filter" type="search" className="search gloss-filter" placeholder="Find a term, e.g. hold" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <dl className="gloss">
            {shown.map(([term, text]) => (
              <div key={term} id={slug(term)} tabIndex={-1} className={at && slug(at) === slug(term) ? "on" : undefined}>
                <dt>{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
            {shown.length === 0 && <p className="muted">No term matches “{filter.trim()}”.</p>}
          </dl>
        </div>
      </dialog>
    </>
  );
}
