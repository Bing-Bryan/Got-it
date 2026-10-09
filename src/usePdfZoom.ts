import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PdfPageInfo } from './lib/pdf-data';

export const MIN_ZOOM = .25, MAX_ZOOM = 4;
export const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
export const sliderZoom = (value: number) => MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, value / 1000);
export const zoomSlider = (value: number) => 1000 * Math.log(clampZoom(value) / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);
export const pageBaseWidth = (page: PdfPageInfo) => page.rotation === 90 || page.rotation === 270 ? page.view[3] - page.view[1] : page.view[2] - page.view[0];
const storageKey = (id: string) => `got-it.pdf-zoom.v1.${id}`;
function readZoom(id: string): number | null {
  try { const value = Number(localStorage.getItem(storageKey(id))); return Number.isFinite(value) && value >= MIN_ZOOM && value <= MAX_ZOOM ? value : null; } catch { return null; }
}
type Anchor = { node: HTMLElement; x: number; y: number; screenX: number; screenY: number };
type Point = { x: number; y: number };

export function usePdfZoom(root: RefObject<HTMLDivElement | null>, id: string, page: PdfPageInfo) {
  const [manual, setManual] = useState<number | null>(() => readZoom(id));
  const [fitWidth, setFitWidth] = useState(700);
  const anchor = useRef<Anchor | null>(null);
  const scrollElement = () => root.current?.closest<HTMLElement>('.reader-scroll,.recovery-original');
  const current = useRef({ manual, fitWidth, base: pageBaseWidth(page) });
  current.current = { manual, fitWidth, base: pageBaseWidth(page) };
  const capture = (point?: Point) => {
    const scroll = scrollElement(); if (!scroll || !root.current) return;
    const bounds = scroll.getBoundingClientRect();
    const tools = root.current.querySelector('.pdf-toolbar')?.getBoundingClientRect();
    const x = point?.x ?? bounds.left + scroll.clientWidth / 2;
    const y = point?.y ?? (Math.max(bounds.top, tools?.bottom ?? bounds.top) + bounds.bottom) / 2;
    const sheets = [...root.current.querySelectorAll<HTMLElement>('.pdf-page')];
    const node = sheets.find(p => { const r = p.getBoundingClientRect(); return r.top <= y && r.bottom > y; }) ?? sheets.find(p => p.getBoundingClientRect().bottom > Math.max(bounds.top, tools?.bottom ?? bounds.top));
    if (!node) return;
    const rect = node.getBoundingClientRect();
    anchor.current = { node, x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, screenX: x - bounds.left, screenY: y - bounds.top };
  };
  const change = (value: number | null, point?: Point) => {
    if (value !== null && !Number.isFinite(value)) return;
    capture(point);
    const next = value === null ? null : clampZoom(value);
    current.current.manual = next; setManual(next);
    try { if (next === null) localStorage.removeItem(storageKey(id)); else localStorage.setItem(storageKey(id), String(next)); } catch { /* Session controls still work. */ }
  };
  const actions = useRef({ change, capture }); actions.current = { change, capture };
  useLayoutEffect(() => {
    const a = anchor.current, scroll = scrollElement(); anchor.current = null;
    if (!a || !scroll || !a.node.isConnected) return;
    const r = a.node.getBoundingClientRect(), bounds = scroll.getBoundingClientRect();
    const left = scroll.scrollLeft + r.left + a.x * r.width - bounds.left - a.screenX;
    const top = scroll.scrollTop + r.top + a.y * r.height - bounds.top - a.screenY;
    if (typeof scroll.scrollTo === 'function') scroll.scrollTo({ left, top, behavior: 'instant' });
    else { scroll.scrollLeft = left; scroll.scrollTop = top; }
  }, [manual, fitWidth]);
  useEffect(() => { setManual(readZoom(id)); }, [id]);
  useEffect(() => {
    const el = root.current; if (!el) return;
    const observed = scrollElement() ?? el;
    const resize = () => {
      const next = Math.max(120, observed.clientWidth - 40);
      if (next === current.current.fitWidth) return;
      if (current.current.manual === null) actions.current.capture();
      current.current.fitWidth = next; setFitWidth(next);
    };
    const observer = new ResizeObserver(resize); observer.observe(observed); resize();
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    const el = root.current; if (!el) return;
    let gestureStart = 1, gesturing = false;
    const inContent = (target: EventTarget | null) => target instanceof Element && !target.closest('.pdf-toolbar,.reading-adjustment,.pdf-selection-card,input,textarea,button');
    const scaleNow = () => current.current.manual ?? current.current.fitWidth / current.current.base;
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !inContent(event.target)) return;
      event.preventDefault(); if (gesturing) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
      actions.current.change(scaleNow() * Math.exp(-Math.max(-100, Math.min(100, delta)) * .005), { x: event.clientX, y: event.clientY });
    };
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    const start = (event: Event) => { if (!inContent(event.target)) return; event.preventDefault(); gestureStart = scaleNow(); gesturing = true; };
    const move = (event: Event) => { if (!gesturing) return; event.preventDefault(); const e = event as Gesture; actions.current.change(gestureStart * e.scale, Number.isFinite(e.clientX) ? { x: e.clientX, y: e.clientY } : undefined); };
    const end = () => { gesturing = false; };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', start, { passive: false }); el.addEventListener('gesturechange', move, { passive: false }); el.addEventListener('gestureend', end);
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('gesturestart', start); el.removeEventListener('gesturechange', move); el.removeEventListener('gestureend', end); };
  }, [root]);
  return { manual, fitWidth, scale: manual ?? fitWidth / pageBaseWidth(page), change, widthFor: (info: PdfPageInfo) => manual === null ? fitWidth : pageBaseWidth(info) * manual };
}
