import { PDF_PARAGRAPH_VERSION, pdfParagraphs, type PdfPageParagraphs, type PdfTextItem } from "./pdf-paragraphs";
import { sha256Hex } from "./sha256-sync";
import { TRANSLATION_LIMITS, type TranslationSource, type TranslationUnit } from "./web-translation";

// PDF translation: per-page paragraphs rebuilt from the text layer. Only the minimal pdf.js
// surface is used so the browser and the local server share this code unchanged.
export const PDF_TRANSLATION_SOURCE = "pdf1";
const UNIT_TARGET = 3600;

export interface PdfTextSource {
  numPages: number;
  getPage(page: number): Promise<{ view: number[]; getTextContent(): Promise<{ items: unknown[] }> }>;
}
// keeps: per unit, the web addresses replaced by [GOTIT_KEEP_n] placeholders (restored in the draft).
export interface PdfTranslationSource { kind: "pdf"; source: TranslationSource; sourceVersion: string; pages: PdfPageParagraphs[]; keeps: Record<string, string[]> }

export function pdfTranslationVersion(resourceId: string): string {
  return sha256Hex(`${PDF_TRANSLATION_SOURCE}\n${resourceId}\n${PDF_PARAGRAPH_VERSION}`);
}

function textItems(items: unknown[]): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  for (const raw of items) {
    const i = raw as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
    if (typeof i.str !== "string" || !Array.isArray(i.transform) || i.transform.length < 6) continue;
    const [, , c, d, x, y] = i.transform as number[];
    const height = typeof i.height === "number" && i.height > 0 ? i.height : Math.hypot(c, d);
    out.push({ str: i.str, x, y, width: typeof i.width === "number" ? i.width : i.str.length * height * 0.5, height });
  }
  return out;
}

// A sentence longer than the target is cut at the last space (or never inside a surrogate pair).
function hardCut(sentence: string): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > UNIT_TARGET) {
    let cut = rest.lastIndexOf(" ", UNIT_TARGET);
    if (cut < UNIT_TARGET / 2) { cut = UNIT_TARGET; if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--; }
    parts.push(rest.slice(0, cut).trim()); rest = rest.slice(cut);
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

// Long paragraphs are cut at sentence ends so every unit stays within the translation limit.
function splitParagraph(text: string): string[] {
  if (text.length <= UNIT_TARGET) return [text];
  // Every character belongs to exactly one sentence (leading punctuation included).
  const sentences = text.match(/[^.!?。！？]*[.!?。！？]+["'”’)]*\s*|[^.!?。！？]+$/g) ?? [text];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > UNIT_TARGET) { parts.push(current.trim()); current = ""; }
    if (sentence.length > UNIT_TARGET) { if (current.trim()) parts.push(current.trim()); current = ""; parts.push(...hardCut(sentence)); continue; }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(p => p.length && p.length <= TRANSLATION_LIMITS.unitChars);
}

export function pdfSourceFromPages(pages: PdfPageParagraphs[], resourceId: string): PdfTranslationSource {
  const units: TranslationUnit[] = [];
  const blocks = pages.flatMap(p => p.paragraphs.map(paragraph => ({ id: paragraph.id, text: paragraph.text, headingPath: [`第 ${p.page} 页`], tag: "p" })));
  const keeps: Record<string, string[]> = {};
  for (const block of blocks) splitParagraph(block.text).forEach((part, index) => {
    // Web addresses are kept verbatim: never sent for translation, restored in the Chinese draft.
    const id = `${block.id}--v2-part${index}`, kept: string[] = [];
    const text = part.replace(PDF_URL, url => `[GOTIT_KEEP_${kept.push(url) - 1}]`);
    if (kept.length) keeps[id] = kept;
    units.push({ id, blockId: block.id, text });
  });
  return { kind: "pdf", sourceVersion: pdfTranslationVersion(resourceId), pages, keeps, source: { html: "", blocks, units } };
}

// Normal addresses, plus addresses that a PDF text layer spells out with spaces ("https : / / arxiv . org / abs / …").
// A space after a separator is part of the address when the separator is also spaced before, or when the
// next segment continues in lowercase/digits ("arxiv. org"). It is a sentence break when the next word is
// capitalised ("example.com/foo. This paper"), so that word is not swallowed into the kept address.
// Case is spelled out instead of /i so that the lowercase check above stays meaningful.
const PDF_URL = /(?:[Hh][Tt][Tt][Pp][Ss]?)\s*:\s*\/\s*\/\s*[A-Za-z0-9_~%-]+(?:(?:\s+[./?#=&:+]\s+|[./?#=&:+])[A-Za-z0-9_~%-]+|[./?#=&:+]\s+(?=[a-z0-9])[A-Za-z0-9_~%-]+)*|(?:[Hh][Tt][Tt][Pp][Ss]?:\/\/|[Ww][Ww][Ww]\.)[^\s<>"'）)\]]+[^\s<>"'）)\].,;:!?]/g;
export function restorePdfKeeps(source: PdfTranslationSource, unitId: string, text: string): string {
  const kept = source.keeps[unitId];
  return kept ? text.replace(/\[GOTIT_KEEP_(\d+)\]/g, (token, n) => kept[Number(n)]?.replace(/\s+/g, "") ?? token) : text;
}

export async function pdfTranslationSource(pdf: PdfTextSource, resourceId: string, signal?: AbortSignal): Promise<PdfTranslationSource> {
  const pages: PdfPageParagraphs[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    signal?.throwIfAborted();
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const [x0, y0, x1, y1] = page.view;
    pages.push(pdfParagraphs(n, textItems(content.items), [x0, y0, x1, y1]));
  }
  return pdfSourceFromPages(pages, resourceId);
}
