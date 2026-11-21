// What each piece of evidence says, as a sentence a controller can check. Built here from the recorded
// tool result so the browser never parses tool output or decides which row applies.

type AnyState = Record<string, any>;

export interface EvidenceSummary {
  /** A specific title when the content gives one; otherwise the page names the source system. */
  title?: string;
  body: string;
}

const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: unknown) => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isNaN(t) ? String(iso ?? "") : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
/** "$4788.00" as the tools write it -> "$4,788.00". */
const groupDollars = (text: string) => text.replace(/\$(\d+)(\.\d{2})?/g, (_, whole: string, frac = "") => `$${Number(whole).toLocaleString("en-US")}${frac}`);
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** The records in a tool result: one JSON object per line, or one JSON array. A cut-off last record is dropped. */
export function recordsOf(excerpt: string): { rows: AnyState[]; truncated: boolean } {
  const text = excerpt.trim();
  const truncated = /\[cut at \d+ characters\]\s*$/.test(text);
  try {
    const whole = JSON.parse(text);
    if (Array.isArray(whole)) return { rows: whole.filter((r) => r && typeof r === "object"), truncated };
    if (whole && typeof whole === "object") return { rows: [whole], truncated };
  } catch {
    /* not one document: read it line by line */
  }
  const rows: AnyState[] = [];
  let dropped = false;
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l.startsWith("{")) continue;
    try {
      rows.push(JSON.parse(l));
    } catch {
      dropped = true;
    }
  }
  return { rows, truncated: truncated || dropped };
}

function contractPrices(rows: AnyState[], invoiceDate: string | undefined): EvidenceSummary {
  const at = Date.parse(invoiceDate ?? "");
  const sorted = [...rows].sort((a, b) => Date.parse(a.effective_from) - Date.parse(b.effective_from));
  const inEffect = (r: AnyState) => !Number.isNaN(at) && Date.parse(r.effective_from) <= at && (r.effective_to == null || at <= Date.parse(r.effective_to));
  const span = (r: AnyState) => `${day(r.effective_from)} ${r.effective_to ? `to ${day(r.effective_to)}` : "onward"}`;
  const current = sorted.find(inEffect);
  const item = sorted[0]?.item_id ?? "Item";
  const others = sorted.filter((r) => r !== current).map((r) => `${money(r.price_cents)} (${span(r)})`);
  if (current) {
    return {
      title: "Contract Price",
      body: `${item}: ${money(current.price_cents)} a unit, in effect on the invoice date (${day(invoiceDate)}); valid ${span(current)}.${others.length ? ` Other prices on file: ${others.join("; ")}.` : ""}`,
    };
  }
  return {
    title: sorted.length === 1 ? "Contract Price" : "Contract Prices",
    body: `${item}: ${sorted.map((r) => `${money(r.price_cents)} (${span(r)})`).join("; ")}.${Number.isNaN(at) ? "" : ` None is in effect on the invoice date (${day(invoiceDate)}).`}`,
  };
}

function messages(rows: AnyState[]): EvidenceSummary {
  const m = rows[0]!;
  const body = String(m.body ?? "").replace(/\s+/g, " ").trim();
  const more = rows.length > 1 ? ` ${rows.length - 1} more ${rows.length === 2 ? "message" : "messages"} in the raw output.` : "";
  return {
    title: `Vendor Message, ${day(m.sent_at)}`,
    body: `“${m.subject}” from ${m.from_address ?? "an unknown sender"}.${body ? ` ${cut(body, 220)}` : ""}${more}`,
  };
}

/** One evidence item in plain language. `state` is the case state the item belongs to. */
export function summarizeEvidence(e: AnyState, state: AnyState, dueDate?: string): EvidenceSummary {
  const raw = String(e.excerpt ?? "").trim();
  const source = String(e.source ?? "");
  if (!raw || /^\(no rows\)$/i.test(raw)) return { body: "The search returned nothing." };

  if (source.startsWith("docs:")) {
    const inv = state.invoice;
    if (!inv) return { body: "The vendor’s document, read as text." };
    const parts = [inv.invoiceDate && `dated ${day(inv.invoiceDate)}`, inv.poReference && `for ${inv.poReference}`, dueDate && `due ${day(dueDate)}`, inv.totalDue && `total ${inv.totalDue}`].filter(Boolean);
    return { title: `Invoice ${inv.vendorInvoiceNumber}`, body: parts.length ? `${parts.join(", ").replace(/^d/, "D")}.` : "The vendor’s document, read as text." };
  }

  if (source.startsWith("match-engine:")) {
    // "CODE: sentence" per finding; the code is shown elsewhere as the exception type.
    const lines = raw.split("\n").map((l) => groupDollars(l.replace(/^[A-Z_]+:\s*/, "").trim())).filter(Boolean);
    return { title: "Three-Way Match", body: lines.join(" ") };
  }

  const { rows, truncated } = recordsOf(raw);
  const note = truncated ? " The recorded result was cut short; the rest is not shown." : "";
  if (rows.length === 0) return { body: cut(groupDollars(raw.replace(/\s+/g, " ")), 240) };
  if (rows.every((r) => typeof r.price_cents === "number" && r.effective_from)) {
    const s = contractPrices(rows, state.invoice?.invoiceDate);
    return { ...s, body: s.body + note };
  }
  if (rows.every((r) => r.subject && r.sent_at)) {
    const s = messages(rows);
    return { ...s, body: s.body + note };
  }
  // A record type with no specific wording: its leading fields, as recorded.
  const first = Object.entries(rows[0]!)
    .filter(([, v]) => v != null && typeof v !== "object")
    .slice(0, 5)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(", ");
  return { body: `${rows.length} ${rows.length === 1 ? "record" : "records"} returned. ${rows.length === 1 ? "It reads" : "The first reads"}: ${cut(first, 220)}.${note}` };
}

/** Summaries for every evidence item of a case, by reference (E1, E2, ...). */
export function evidenceSummaries(state: AnyState | undefined, dueDate?: string): Record<string, EvidenceSummary> {
  const out: Record<string, EvidenceSummary> = {};
  for (const e of state?.evidence ?? []) out[String(e.ref)] = summarizeEvidence(e, state!, dueDate);
  return out;
}
