// Rebuilds reading-order paragraphs from a PDF page's text items, for translation only.
// Pure and deterministic so the browser and the local server derive identical units.
// Coordinates are PDF user space (y grows upward). Bump the version whenever output changes.
// Bump whenever paragraphs or unit texts change (including what is protected from translation).
export const PDF_PARAGRAPH_VERSION = 5;

export interface PdfTextItem { str: string; x: number; y: number; width: number; height: number }
// rects: line boxes in PDF user space [x0, y0, x1, y1], used to show a draft sticky on the original page.
export interface PdfParagraph { id: string; page: number; text: string; rects: [number, number, number, number][] }
export interface PdfPageParagraphs { page: number; paragraphs: PdfParagraph[]; scanned: boolean }

interface Line { text: string; x0: number; x1: number; y: number; height: number }

const letters = (text: string) => (text.match(/[A-Za-zÀ-ɏ㐀-鿿]/g) ?? []).length;
// Long text without ordinary lowercase words is a chart legend, axis or table row, not prose.
const plainWords = (text: string) => text.split(/\s+/).filter(w => /^[a-z]{3,}[,.;:)]?$/.test(w)).length;
const prose = (text: string) => text.length < 60 || plainWords(text) >= 3;
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };

function toLines(items: PdfTextItem[], mid: number, gutter: number): Line[] {
  const sorted = items.filter(i => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { items: PdfTextItem[]; y: number; height: number }[] = [];
  for (const item of sorted) {
    const line = lines.find(l => Math.abs(l.y - item.y) <= Math.max(l.height, item.height) * 0.5);
    if (line) { line.items.push(item); line.height = Math.max(line.height, item.height); }
    else lines.push({ items: [item], y: item.y, height: item.height });
  }
  // Items at the same height split into separate lines at a wide gap, or at any clear gap that
  // straddles the page centre (a narrow two-column gutter, often only about one line height wide).
  return lines.flatMap(l => {
    const parts = l.items.sort((a, b) => a.x - b.x);
    const segments: Line[] = [];
    let text = "", start = parts[0].x, end = -Infinity;
    const close = () => { if (text.trim()) segments.push({ text: text.replace(/\s+/g, " ").trim(), x0: start, x1: end, y: l.y, height: l.height }); };
    for (const p of parts) {
      const gap = p.x - end;
      if (text && (gap > Math.max(l.height * 3, 18) || (gap > l.height * 0.8 && end <= mid + gutter && p.x >= mid - gutter))) { close(); text = ""; start = p.x; end = -Infinity; }
      else if (text && !/\s$/.test(text) && !/^\s/.test(p.str) && gap > l.height * 0.15) text += " ";
      text += p.str;
      end = Math.max(end, p.x + p.width);
    }
    close();
    return segments;
  });
}

// Two columns: enough lines sit entirely on each side of the page centre.
function readingOrder(lines: Line[], left: number, width: number): Line[][] {
  const mid = left + width / 2, gutter = width * 0.02;
  const leftOnly = lines.filter(l => l.x1 <= mid + gutter), rightOnly = lines.filter(l => l.x0 >= mid - gutter);
  if (leftOnly.length < lines.length * 0.25 || rightOnly.length < lines.length * 0.25) return [lines];
  const groups: Line[][] = [];
  let band: Line[] = [], spanningRun: Line[] = [];
  const flush = () => {
    if (!band.length) return;
    groups.push(band.filter(l => l.x1 <= mid + gutter), band.filter(l => l.x0 >= mid - gutter && !(l.x1 <= mid + gutter)));
    band = [];
  };
  // Consecutive full-width lines (a title or an abstract above the columns) stay one block,
  // so paragraphsOf can join them instead of making one paragraph per line.
  const flushSpanning = () => { if (spanningRun.length) groups.push(spanningRun); spanningRun = []; };
  for (const line of lines) {
    const spanning = line.x0 < mid - gutter && line.x1 > mid + gutter;
    if (spanning) { flush(); spanningRun.push(line); } else { flushSpanning(); band.push(line); }
  }
  flushSpanning(); flush();
  return groups.filter(g => g.length);
}

interface Block { text: string; lines: Line[] }
function paragraphsOf(lines: Line[]): Block[] {
  const out: Block[] = [];
  if (!lines.length) return out;
  const lineHeight = median(lines.map(l => l.height)) || 10;
  const typicalWidth = median(lines.map(l => l.x1 - l.x0));
  let current = lines[0].text, members = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1], line = lines[i];
    const gap = prev.y - line.y - prev.height;
    const sizeChange = Math.abs(line.height - prev.height) > Math.max(prev.height, line.height) * 0.2;
    const prevEnded = prev.x1 - prev.x0 < typicalWidth * 0.75 && /[.!?:;。！？：；]["'”’)]?$/.test(prev.text);
    if (gap > lineHeight * 0.8 || sizeChange || prevEnded) { out.push({ text: current, lines: members }); current = line.text; members = [line]; continue; }
    current = /[A-Za-z]-$/.test(current) && /^[a-z]/.test(line.text) ? current.slice(0, -1) + line.text : `${current} ${line.text}`;
    members.push(line);
  }
  out.push({ text: current, lines: members });
  return out;
}

export function pdfParagraphs(page: number, items: PdfTextItem[], view: [number, number, number, number]): PdfPageParagraphs {
  const [x0, y0, x1, y1] = view, width = x1 - x0, height = y1 - y0;
  const all = toLines(items, x0 + width / 2, width * 0.02);
  // Image-only page: practically no text layer. Pages with only a few words are not "scanned";
  // they simply have no translatable paragraphs.
  if (letters(all.map(l => l.text).join("")) < 3) return { page, paragraphs: [], scanned: true };
  // Running headers / footers and bare page numbers are not part of the reading text.
  const body = all.filter(l => !/^\d{1,4}$/.test(l.text) && !((l.y > y1 - height * 0.05 || l.y < y0 + height * 0.05) && l.text.length < 80));
  // Tiny fragments (pseudo-code keywords, chart tick labels, symbols) stay on the original page.
  // Charts, legends and tables stay on the original page (the draft notice points there).
  const blocks = readingOrder(body, x0, width).flatMap(paragraphsOf).filter(b => letters(b.text) >= 6 && prose(b.text));
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  // Baseline-based line boxes, kept inside the page so saved anchors stay valid.
  const box = (l: Line): [number, number, number, number] => [clamp(l.x0, x0, x1), clamp(l.y - l.height * 0.25, y0, y1), clamp(l.x1, x0, x1), clamp(l.y + l.height * 0.85, y0, y1)];
  return { page, scanned: false, paragraphs: blocks.map((b, index) => ({ id: `pdf-p${page}-b${index}`, page, text: b.text, rects: b.lines.map(box).filter(r => r[2] - r[0] > 0.5 && r[3] - r[1] > 0.5).slice(0, 500) })) };
}
