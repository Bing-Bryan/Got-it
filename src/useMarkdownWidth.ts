import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const MARKDOWN_WIDTH_KEY = 'got-it.markdown-width.v1';
export const DEFAULT_MARKDOWN_WIDTH = 80;
export const clampMarkdownWidth = (value: number) => Math.max(50, Math.min(100, Math.round(value)));
function readWidth() {
  try {
    const value = Number(localStorage.getItem(MARKDOWN_WIDTH_KEY));
    return Number.isFinite(value) && value >= 50 && value <= 100 ? Math.round(value) : DEFAULT_MARKDOWN_WIDTH;
  } catch { return DEFAULT_MARKDOWN_WIDTH; }
}
export function useMarkdownWidth(article: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(readWidth);
  const anchor = useRef<{ node: HTMLElement; top: number } | null>(null);
  const adjusting = useRef(false);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const change = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next = clampMarkdownWidth(value);
    if (next === width) return;
    const scroll = article.current?.closest<HTMLElement>('.reader-scroll');
    if (scroll && article.current) {
      const top = scroll.getBoundingClientRect().top;
      const node = [...article.current.querySelectorAll<HTMLElement>('[data-block-id]')].find(el => el.getBoundingClientRect().bottom > top + 1);
      anchor.current = node ? { node, top: node.getBoundingClientRect().top } : null;
    }
    adjusting.current = true;
    cancelAnimationFrame(frame.current);
    setWidth(next);
    try { localStorage.setItem(MARKDOWN_WIDTH_KEY, String(next)); } catch { /* Session preference still works. */ }
  };
  useLayoutEffect(() => {
    if (!adjusting.current) return;
    const scroll = article.current?.closest<HTMLElement>('.reader-scroll');
    const saved = anchor.current; anchor.current = null;
    if (scroll && saved?.node.isConnected) scroll.scrollTo({ top: scroll.scrollTop + saved.node.getBoundingClientRect().top - saved.top, behavior: 'instant' });
    // Ignore only scroll events produced by this layout change, not normal reading.
    frame.current = requestAnimationFrame(() => { frame.current = requestAnimationFrame(() => { adjusting.current = false; }); });
  }, [width, article]);
  return { width, change, adjusting };
}
