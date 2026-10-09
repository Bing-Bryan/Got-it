import { expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfReadingMinutes } from './pdf-reading-time';
function document(texts: string[]) {
  const render = vi.fn(() => { throw new Error('Must not render for an estimate'); });
  const getPage = vi.fn(async (n: number) => ({ getTextContent: vi.fn(async () => ({items:[{str:texts[n-1]}]})), render }));
  return { pdf: {numPages:texts.length,getPage} as unknown as PDFDocumentProxy, getPage, render };
}
it('counts all native pages, caches only completed estimates and never renders', async () => {
  const {pdf,getPage,render}=document(['中'.repeat(400), 'word '.repeat(200)]);
  expect(await pdfReadingMinutes(pdf, 'native', new AbortController().signal)).toBe(2);
  expect(await pdfReadingMinutes(pdf, 'native', new AbortController().signal)).toBe(2);
  expect(getPage).toHaveBeenCalledTimes(2); expect(render).not.toHaveBeenCalled();
});
it.each([[''], ['Header '.repeat(5)], ['中'.repeat(800), '', '']])('omits sparse or mixed scanned pages', async (...texts) => {
  const {pdf}=document(texts);
  expect(await pdfReadingMinutes(pdf, texts.join('|'), new AbortController().signal)).toBeNull();
});
it('allows one short cover among five text-rich pages', async () => {
  const {pdf}=document(['封面', ...Array(4).fill('中'.repeat(200))]);
  expect(await pdfReadingMinutes(pdf,'cover',new AbortController().signal)).toBe(3);
});
it('aborts in-flight reads without caching partial text and can retry', async () => {
  const controller=new AbortController();
  const pdf={numPages:2,getPage:vi.fn(()=>new Promise(()=>{}))} as unknown as PDFDocumentProxy;
  const pending=pdfReadingMinutes(pdf,'cancelled',controller.signal);controller.abort();
  await expect(pending).rejects.toThrow();
  const retry=document(['中'.repeat(400)]);
  expect(await pdfReadingMinutes(retry.pdf,'cancelled',new AbortController().signal)).toBe(1);
});
it('does not cache a failure or return a partial estimate', async () => {
  const pdf={numPages:2,getPage:vi.fn().mockRejectedValue(new Error('broken'))} as unknown as PDFDocumentProxy;
  await expect(pdfReadingMinutes(pdf,'failed',new AbortController().signal)).rejects.toThrow('broken');
  expect(await pdfReadingMinutes(document(['中'.repeat(400)]).pdf,'failed',new AbortController().signal)).toBe(1);
});
