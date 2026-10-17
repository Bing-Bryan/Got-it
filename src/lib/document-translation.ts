import type { DocumentSnapshot } from "../types";
import { buildTranslationSource, copyWebTranslation, type TranslationSource, type WebTranslationState } from "./web-translation";
import { pdfTranslationVersion } from "./pdf-translation";
import { sha256Hex } from "./sha256-sync";

// Translation sources by document kind. Web documents keep their existing content version;
// Markdown derives a 64-hex version from its text so stale translations are never reused.
export const MARKDOWN_TRANSLATION_SOURCE = "md1";

export interface DocumentTranslationSource { kind: "web" | "markdown"; source: TranslationSource; sourceVersion: string }

export function markdownTranslationVersion(markdown: string): string {
  return sha256Hex(`${MARKDOWN_TRANSLATION_SOURCE}\n${markdown}`);
}

export function documentTranslationSource(doc: DocumentSnapshot): DocumentTranslationSource | null {
  if (doc.kind === "web") return { kind: "web", source: buildTranslationSource(doc.markdown, doc.web), sourceVersion: doc.web.contentVersion };
  if (doc.kind === "pdf") return null;
  return { kind: "markdown", source: buildTranslationSource(doc.markdown), sourceVersion: markdownTranslationVersion(doc.markdown) };
}

// Version check for every kind, without rebuilding units (PDF units need the file's text layer).
export function documentTranslationVersion(doc: DocumentSnapshot): string {
  return doc.kind === "pdf" ? pdfTranslationVersion(doc.pdf.resourceId) : documentTranslationSource(doc)!.sourceVersion;
}

const PDF_UNIT = /^pdf-p(\d{1,3})-b\d{1,4}--v2-part\d{1,2}$/;
export function copyPdfTranslation(value: unknown, documentId: string, resourceId: string, pageCount: number): WebTranslationState | undefined {
  const state = copyWebTranslation(value, documentId, pdfTranslationVersion(resourceId));
  if (!state) return undefined;
  for (const id of Object.keys(state.units)) { const m = PDF_UNIT.exec(id); if (!m || Number(m[1]) < 1 || Number(m[1]) > pageCount) return undefined; }
  // Without the text layer completeness cannot be checked here, so a saved "complete" is kept;
  // the reader recomputes missing paragraphs against the real source before showing progress or resuming.
  return (value as { status?: unknown }).status === "complete" ? { ...state, status: "complete" } : state;
}
