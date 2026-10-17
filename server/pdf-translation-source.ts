import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pdfTranslationSource, type PdfTextSource, type PdfTranslationSource } from '../src/lib/pdf-translation';
import { WebError } from './web-fetch';
import type { ReadingLibrary } from './reading-library';

// Rebuilds PDF translation units from the saved file, never from client text. Same pdf.js
// version and font data as the browser, so both sides derive identical paragraph ids.
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
// pdf.js in Node reads font data with fs, so these are plain paths (not file URLs).
const assetUrl = (dir: string) => join(pdfjsRoot, dir) + '/';
const cache = new Map<string, Promise<PdfTranslationSource>>();

async function parse(bytes: Uint8Array, resourceId: string): Promise<PdfTranslationSource> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: bytes, cMapUrl: assetUrl('cmaps'), cMapPacked: true, standardFontDataUrl: assetUrl('standard_fonts'), wasmUrl: assetUrl('wasm'), enableXfa: false, useSystemFonts: false, stopAtErrors: true });
  try { return await pdfTranslationSource(await task.promise as unknown as PdfTextSource, resourceId); }
  finally { await task.destroy().catch(() => {}); }
}

export async function serverPdfTranslationSource(library: ReadingLibrary, entryId: string, resourceId: string): Promise<PdfTranslationSource> {
  // Authorization is checked on every call; only the parse of the verified bytes is cached.
  const { bytes } = await library.resources.read(entryId, resourceId);
  let pending = cache.get(resourceId);
  if (!pending) {
    pending = parse(new Uint8Array(bytes), resourceId);
    cache.set(resourceId, pending);
    while (cache.size > 4) cache.delete(cache.keys().next().value!);
    pending.catch(() => cache.delete(resourceId));
  }
  try { return await pending; }
  catch { throw new WebError('PDF 文字层读取失败，暂不能全文翻译。', 'translation_source', 422); }
}
