import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { screenRect } from './lib/pdf-geometry';
import type { PdfRect } from './lib/pdf-data';

type Viewport = ReturnType<PDFPageProxy['getViewport']>;
export interface InPlaceParagraph { id: string; text: string; rects: PdfRect[] }
interface Box { id: string; text: string; left: number; top: number; width: number; height: number; line: number }

const MIN_SCREEN_PX = 9, MIN_RATIO = 0.6, MIN_SQUEEZE = 0.75, STEP = 0.92, WHITE: [number, number, number] = [255, 255, 255];
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };

// Page colour just outside a paragraph box (one readback per box), so the Chinese covers the original
// words without a white patch. A blank or unreadable canvas falls back to white, never to black.
function backdrop(canvas: HTMLCanvasElement | null, box: Box, scale: number): [number, number, number] {
  try {
    const context = canvas?.getContext('2d');
    if (!canvas || !context || typeof context.getImageData !== 'function') return WHITE;
    const x0 = Math.max(0, Math.floor((box.left - 3) * scale)), y0 = Math.max(0, Math.floor((box.top - 3) * scale));
    const x1 = Math.min(canvas.width - 1, Math.ceil((box.left + box.width + 3) * scale)), y1 = Math.min(canvas.height - 1, Math.ceil((box.top + box.height + 3) * scale));
    if (x1 <= x0 || y1 <= y0) return WHITE;
    const width = x1 - x0 + 1, data = context.getImageData(x0, y0, width, y1 - y0 + 1).data, samples: number[][] = [];
    const at = (x: number, y: number) => { const i = ((y - y0) * width + (x - x0)) * 4; if (data[i + 3] === 255) samples.push([data[i], data[i + 1], data[i + 2]]); };
    for (let i = 0; i <= 10; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / 10), y = Math.round(y0 + (y1 - y0) * i / 10);
      at(x, y0); at(x, y1); at(x0, y); at(x1, y);
    }
    return samples.length >= 8 ? [0, 1, 2].map(c => median(samples.map(s => s[c]))) as [number, number, number] : WHITE;
  } catch { return WHITE; }
}

/** Chinese drawn over each translated paragraph's own box; figures, formulas and other text stay as rendered. */
export function PdfTranslationLayer({ page, viewport, paragraphs, canvas, displayScale }: { page: number; viewport: Viewport; paragraphs: InPlaceParagraph[]; canvas: HTMLCanvasElement | null; displayScale: number }) {
  const layer = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<string | null>(null);
  const boxes = useMemo(() => paragraphs.flatMap((p): Box[] => {
    const rects = p.rects.map(r => screenRect(viewport, r)).filter(r => r[2] > r[0] && r[3] > r[1]);
    if (!rects.length) return [];
    const line = median(rects.map(r => r[3] - r[1])), pad = line * 0.15;
    const left = Math.min(...rects.map(r => r[0])) - 1, top = Math.min(...rects.map(r => r[1])) - pad;
    return [{ id: p.id, text: p.text, line, left, top, width: Math.max(...rects.map(r => r[2])) + 1 - left, height: Math.max(...rects.map(r => r[3])) + pad - top }];
  }), [paragraphs, viewport]);
  const minFont = MIN_SCREEN_PX / Math.max(displayScale, 0.01);
  useLayoutEffect(() => {
    const host = layer.current; if (!host) return;
    const cut = new Set<string>(), ratio = canvas && viewport.width ? canvas.width / viewport.width : 1;
    const elements = new Map([...host.querySelectorAll<HTMLElement>('.pdf-translation-paragraph')].map(el => [el.dataset.pdfParagraph, el]));
    for (const box of boxes) {
      const element = elements.get(box.id);
      if (!element) continue;
      const [r, g, b] = backdrop(canvas, box, ratio);
      element.style.backgroundColor = `rgb(${r},${g},${b})`;
      element.style.color = 0.299 * r + 0.587 * g + 0.114 * b < 128 ? '#ffffff' : '#1b1b1f';
      // Shrink within the original box; below the floor the rest is offered on click instead of overflowing.
      // A one-line box (a heading, chart title or label) stays one line and may narrow slightly, as the text layer does.
      const text = element.querySelector<HTMLElement>('.pdf-translation-text'), single = box.height < box.line * 1.7;
      if (text) text.style.transform = '';
      element.style.whiteSpace = single ? 'nowrap' : '';
      element.style.lineHeight = single ? `${box.height}px` : '';
      const over = () => element.scrollWidth > element.clientWidth + 0.5 || element.scrollHeight > element.clientHeight + 0.5;
      // 9 screen px, unless the original itself is drawn smaller (narrow screens): then 85% of it, as zoomable as the original.
      const floor = Math.max(box.line * MIN_RATIO, Math.min(minFont, box.line * 0.85));
      let size = Math.max(box.line * 0.95, floor);
      element.style.fontSize = `${size}px`;
      while (over() && size > floor) { size = Math.max(floor, size * STEP); element.style.fontSize = `${size}px`; }
      if (single && text && element.scrollWidth > element.clientWidth + 0.5 && element.scrollHeight <= element.clientHeight + 0.5) {
        const squeeze = element.clientWidth / element.scrollWidth;
        if (squeeze >= MIN_SQUEEZE) { text.style.transform = `scaleX(${squeeze})`; continue; }
      }
      if (over()) cut.add(box.id);
    }
    setTruncated(current => current.size === cut.size && [...cut].every(id => current.has(id)) ? current : cut);
  }, [boxes, canvas, viewport, minFont]);
  const close = (focus: boolean) => { const id = open; setOpen(null); if (focus && id) requestAnimationFrame(() => layer.current?.querySelector<HTMLButtonElement>(`.pdf-translation-more[data-for="${id}"]`)?.focus()); };
  const opened = open ? boxes.find(b => b.id === open) : undefined;
  // The full text stays inside the page (which clips): it opens on the roomier side and scrolls within.
  let full: CSSProperties | undefined;
  if (opened) {
    const width = Math.min(viewport.width - 8, Math.max(opened.width, 240 / Math.max(displayScale, 0.01)));
    const below = viewport.height - (opened.top + opened.height) - 8, above = opened.top - 8;
    full = { left: Math.max(4, Math.min(opened.left, viewport.width - width - 4)), width, fontSize: Math.max(opened.line, minFont), maxHeight: Math.max(below, above, 60),
      ...(below >= above ? { top: opened.top + opened.height + 4 } : { bottom: viewport.height - opened.top + 4 }) };
  }
  return <div ref={layer} className="pdf-translation-layer" lang="zh-CN" role="group" aria-label={`第 ${page} 页中文`} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(true); } }}>
    {boxes.map(box => <div key={box.id} data-pdf-paragraph={box.id} className={`pdf-translation-paragraph${truncated.has(box.id) ? ' pdf-translation-paragraph--cut' : ''}`} style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <span className="pdf-translation-text">{box.text}</span>
      {truncated.has(box.id) ? <button type="button" data-for={box.id} className="pdf-translation-more" aria-label="查看此段完整中文" title="查看此段完整中文" aria-expanded={open === box.id} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setOpen(current => current === box.id ? null : box.id); }}>…</button> : null}
    </div>)}
    {opened ? <div data-pdf-paragraph={opened.id} className="pdf-translation-full" role="note" style={full} onPointerDown={e => e.stopPropagation()}>
      <span className="pdf-translation-text">{opened.text}</span>
      <button type="button" className="pdf-translation-close" aria-label="收起完整中文" onPointerUp={e => e.stopPropagation()} onClick={() => close(true)}>收起</button>
    </div> : null}
  </div>;
}
