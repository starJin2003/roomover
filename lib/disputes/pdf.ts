/**
 * A plain text PDF for the handoff record that goes to PayPal with a
 * dispute's evidence. Helvetica on US Letter pages, a bold title, and
 * wrapped lines, which is all a reviewer needs to read the record.
 */

const PAGE = { width: 612, height: 792, margin: 54 };
const SIZE = 10;
const LEADING = 14;
const WRAP = 98;
const LINES_PER_PAGE = Math.floor((PAGE.height - PAGE.margin * 2 - 28) / LEADING);

/** PDF strings take printable ASCII here, so typographic quotes and dashes become their plain forms. */
function ascii(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E]/g, "");
}

const escape = (text: string) => ascii(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function wrap(line: string): string[] {
  if (line.length <= WRAP) return [line];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current.length > 0 && current.length + word.length + 1 > WRAP) {
      out.push(current);
      current = `  ${word}`;
    } else current = current.length === 0 ? word : `${current} ${word}`;
  }
  if (current.length > 0) out.push(current);
  return out;
}

export function textPdf(title: string, lines: readonly string[]): Uint8Array<ArrayBuffer> {
  const wrapped = lines.flatMap((line) => wrap(ascii(line)));
  const pages: string[][] = [];
  for (let start = 0; start < Math.max(wrapped.length, 1); start += LINES_PER_PAGE) pages.push(wrapped.slice(start, start + LINES_PER_PAGE));

  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  pages.forEach((pageLines, index) => {
    const top = PAGE.height - PAGE.margin;
    const heading = index === 0 ? `BT /F2 14 Tf ${PAGE.margin} ${top} Td (${escape(title)}) Tj ET\n` : "";
    const firstLine = index === 0 ? top - 28 : top;
    const body = pageLines.map((line, row) => `BT /F1 ${SIZE} Tf ${PAGE.margin} ${firstLine - row * LEADING} Td (${escape(line)}) Tj ET`).join("\n");
    const stream = `${heading}${body}`;
    objects[pageIds[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`;
    objects[pageIds[index] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
