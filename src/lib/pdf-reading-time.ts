import type { PDFDocumentProxy } from 'pdfjs-dist';
import { abortable } from './abortable';
import { readingLoad } from './reading-time';

const cache = new Map<string, number | null>();
// Reuse the reader's loaded PDF; do not import OCR, render pages, or persist text.
export async function pdfReadingMinutes(pdf: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>, hash: string, signal: AbortSignal): Promise<number | null> {
  signal.throwIfAborted();
  if (cache.has(hash)) return cache.get(hash)!;
  let minutes = 0, characters = 0, readablePages = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    signal.throwIfAborted();
    const page = await abortable(pdf.getPage(n), signal);
    const text = await abortable(page.getTextContent(), signal);
    const load = readingLoad(text.items.map(item => 'str' in item ? item.str : '').join(' '));
    minutes += load.minutes; characters += load.characters;
    if (load.characters >= 50) readablePages++;
    // Let rendering and input proceed between pages; never clean up a page used by the reader.
    await abortable(new Promise<void>(resolve => setTimeout(resolve, 0)), signal);
  }
  signal.throwIfAborted();
  const result = pdf.numPages > 0 && readablePages / pdf.numPages >= .8 && characters / pdf.numPages >= 100
    ? Math.max(1, Math.ceil(minutes)) : null;
  if (cache.size >= 10) cache.delete(cache.keys().next().value!);
  cache.set(hash, result);
  return result;
}
