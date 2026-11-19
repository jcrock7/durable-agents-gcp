// A minimal PDF writer and reader for the synthetic invoices: one page, Helvetica, uncompressed
// text. Small enough to read in full, and with no dependency. Real-world PDFs need a real parser;
// this reader only promises to read PDFs that this writer made.

export interface PdfLine {
  text: string;
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
  /** Draw in white at 1pt: invisible on the page, still present in the text layer. */
  hidden?: boolean;
}

const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export function writePdf(lines: PdfLine[], title: string): Uint8Array {
  for (const l of lines) {
    if (/[^\x20-\x7e]/.test(l.text)) throw new Error(`PDF text must be printable ASCII: ${JSON.stringify(l.text)}`);
  }
  const content = lines
    .map((l) => {
      const font = l.bold ? "/F2" : "/F1";
      const size = l.hidden ? 1 : (l.size ?? 10);
      const color = l.hidden ? "1 1 1 rg" : "0 0 0 rg";
      return `BT ${color} ${font} ${size} Tf ${l.x} ${l.y} Td (${escape(l.text)}) Tj ET`;
    })
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Title (${escape(title)}) /Producer (invoice-exception-resolver synthetic data) >>`,
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/**
 * The text layer of a PDF made by writePdf, one string per drawn line, hidden text included
 * (that is the point: hidden text reaches anything that reads the text layer).
 */
export function readPdfText(bytes: Uint8Array): string[] {
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.startsWith("%PDF-")) throw new Error("not a PDF");
  const streams = [...text.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => m[1]!);
  if (streams.length === 0) throw new Error("no uncompressed content stream: this reader only handles the synthetic invoices");
  const lines: string[] = [];
  for (const stream of streams) {
    for (const m of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      lines.push(m[1]!.replace(/\\([\\()])/g, "$1"));
    }
  }
  return lines;
}
