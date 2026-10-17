import { useEffect, useState } from "react";
import { libraryBinary } from "./lib/library-client";
import { loadPdfTranslationSource } from "./lib/pdf-translation-loader";
import { validUnitTranslation, type WebTranslationState } from "./lib/web-translation";
import { restorePdfKeeps, type PdfTranslationSource } from "./lib/pdf-translation";

export type PdfPageTranslationStatus = "done" | "partial" | "pending" | "scanned" | "empty";
export interface PdfDraftParagraph { id: string; text: string; translated: boolean }
export interface PdfTranslationSummary { done: number; textPages: number; scanned: number; units: { completed: number; total: number } }

// Reads the PDF text layer locally (no model call) only when a translation exists or is running.
export function usePdfTranslationSource(entryId: string | undefined, resourceId: string, enabled: boolean) {
  const [source, setSource] = useState<PdfTranslationSource | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled || !entryId) return;
    let live = true; setError(false);
    loadPdfTranslationSource(resourceId, async () => new Uint8Array(await (await libraryBinary(`/entries/${entryId}/resources/${resourceId}`)).arrayBuffer()))
      .then(s => { if (live) setSource(s); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [entryId, resourceId, enabled]);
  return { source: source?.sourceVersion && enabled ? source : null, error };
}

function unitsOf(source: PdfTranslationSource, page: number) {
  const prefix = `pdf-p${page}-`;
  return source.source.units.filter(u => u.blockId.startsWith(prefix));
}

export function pdfPageStatus(source: PdfTranslationSource, state: WebTranslationState | undefined, page: number): PdfPageTranslationStatus {
  const info = source.pages[page - 1];
  if (!info || info.scanned) return "scanned";
  const units = unitsOf(source, page);
  if (!units.length) return "empty";
  const valid = state?.sourceVersion === source.sourceVersion ? units.filter(u => validUnitTranslation(u, state.units[u.id])).length : 0;
  return valid === units.length ? "done" : valid ? "partial" : "pending";
}

export function pdfDraftParagraphs(source: PdfTranslationSource, state: WebTranslationState | undefined, page: number): PdfDraftParagraph[] {
  const usable = state?.sourceVersion === source.sourceVersion ? state : undefined;
  return (source.pages[page - 1]?.paragraphs ?? []).map(paragraph => {
    const units = source.source.units.filter(u => u.blockId === paragraph.id);
    const translated = units.length > 0 && units.every(u => validUnitTranslation(u, usable?.units[u.id]));
    return { id: paragraph.id, translated, text: translated ? units.map(u => restorePdfKeeps(source, u.id, usable!.units[u.id])).join("") : paragraph.text };
  });
}

export function pdfTranslationSummary(source: PdfTranslationSource, state: WebTranslationState | undefined): PdfTranslationSummary {
  const statuses = source.pages.map(p => pdfPageStatus(source, state, p.page));
  const usable = state?.sourceVersion === source.sourceVersion ? state : undefined;
  return {
    done: statuses.filter(s => s === "done").length,
    textPages: statuses.filter(s => s !== "scanned" && s !== "empty").length,
    scanned: statuses.filter(s => s === "scanned").length,
    units: { completed: source.source.units.filter(u => validUnitTranslation(u, usable?.units[u.id])).length, total: source.source.units.length },
  };
}
