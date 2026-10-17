import { pdfTranslationSource, type PdfTextSource, type PdfTranslationSource } from './pdf-translation';

// Browser-side PDF translation source. The resource id is the file's SHA-256, so a parse can be
// reused for the same bytes; pdf.js loads lazily and uses the same font data as the reader.
const cache = new Map<string, Promise<PdfTranslationSource>>();

async function parse(bytes: Uint8Array, resourceId: string): Promise<PdfTranslationSource> {
  const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  GlobalWorkerOptions.workerSrc ||= workerUrl;
  const task = getDocument({ data: bytes, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/', enableXfa: false, useSystemFonts: false, stopAtErrors: true });
  try { return await pdfTranslationSource(await task.promise as unknown as PdfTextSource, resourceId); }
  finally { await task.destroy().catch(() => {}); }
}

export function loadPdfTranslationSource(resourceId: string, readBytes: () => Promise<Uint8Array>): Promise<PdfTranslationSource> {
  let pending = cache.get(resourceId);
  if (!pending) {
    pending = readBytes().then(bytes => parse(bytes, resourceId));
    cache.set(resourceId, pending);
    while (cache.size > 4) cache.delete(cache.keys().next().value!);
    pending.catch(() => cache.delete(resourceId));
  }
  return pending;
}
