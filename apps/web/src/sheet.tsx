import { Fragment, type ReactNode } from "react";

/**
 * The working-paper marks (agent-screen-guidelines.md, Marks). The glyph and its core meaning are the same
 * for every agent; the only thing an agent supplies is the name of the rule a ◇ checks against.
 */
export type MarkKind = "recorded" | "totalled" | "rule" | "absent";
const GLYPH: Record<MarkKind, string> = { recorded: "✓", totalled: "⊕", rule: "◇", absent: "—" };
const SAID: Record<MarkKind, string> = { recorded: "recorded", totalled: "totalled", rule: "checked against a rule", absent: "not recorded" };

export function Mark({ k }: { k: MarkKind }) {
  return (
    <span className={`tk tk-${k}`}>
      <span aria-hidden="true">{GLYPH[k]}</span>
      <span className="sr"> ({SAID[k]})</span>
    </span>
  );
}

/** The pinned legend: what the marks on this sheet mean. */
export function MarkLegend({ ruleName = "a rule", kinds }: { ruleName?: string; kinds?: MarkKind[] }) {
  const show = kinds ?? (["recorded", "totalled", "rule", "absent"] as MarkKind[]);
  const text: Record<MarkKind, string> = {
    recorded: "Recorded by a run, shown as recorded",
    totalled: "Totalled from the records it covers",
    rule: `Checked against ${ruleName}`,
    absent: "Not recorded; shown as absent",
  };
  return (
    <aside className="legend-box" aria-label="Mark legend">
      <h2>Mark Legend</h2>
      <dl>
        {show.map((k) => (
          <div key={k}>
            <dt className="tk" aria-hidden="true">
              {GLYPH[k]}
            </dt>
            <dd>{text[k]}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/** The sheet header: title, the prepared line and the record reference, over a heavy ink rule. */
export function SheetHead({ title, prepared, refLine, refSub, children }: { title: ReactNode; prepared?: ReactNode; refLine?: ReactNode; refSub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sheet-head">
      <div className="sheet-title">
        {children}
        <h1>{title}</h1>
        {prepared && <p>{prepared}</p>}
      </div>
      {(refLine || refSub) && (
        <div className="sheet-ref">
          {refLine && <b>{refLine}</b>}
          {refSub && <span>{refSub}</span>}
        </div>
      )}
    </header>
  );
}

/** Renders an agent's page recipe: the blocks it names, in its order, in the main and margin columns. */
export function SheetColumns({ layout, blocks }: { layout: { main: string[]; margin: string[] }; blocks: Record<string, ReactNode> }) {
  return (
    <div className="sheet-cols">
      <div className="sheet-main">{layout.main.map((id) => blocks[id] && <Fragment key={id}>{blocks[id]}</Fragment>)}</div>
      <div className="sheet-margin">{layout.margin.map((id) => blocks[id] && <Fragment key={id}>{blocks[id]}</Fragment>)}</div>
    </div>
  );
}
