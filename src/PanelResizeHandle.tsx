import { useEffect, useRef, useState, type RefObject } from 'react';

export type PanelDensity = 'full' | 'counts' | 'icons';
export function panelDensity(width: number, previous: PanelDensity = 'full'): PanelDensity {
  if (width < 240 || (previous === 'icons' && width < 252)) return 'icons';
  if (width < 380 || (previous !== 'full' && width < 392)) return 'counts';
  return 'full';
}
const KEY = 'got-it.result-panel-width.v1';
export const clampPanelWidth = (value: number, maximum = 720) => Math.max(220, Math.min(maximum, Math.round(value)));
export function PanelResizeHandle({ panel, onStart, onCollapse }: { panel: RefObject<HTMLElement | null>; onStart: () => void; onCollapse?: () => void }) {
  const [preferred, setPreferred] = useState(() => {
    try { const value = Number(localStorage.getItem(KEY)); return Number.isFinite(value) && value >= 220 && value <= 720 ? value : 404; } catch { return 404; }
  });
  const [bounds, setBounds] = useState({ current: preferred, max: 720 });
  const drag = useRef<{ x: number; width: number; preferred: number; collapse: boolean } | null>(null);
  const latest = useRef(preferred); latest.current = preferred;
  useEffect(() => {
    const frame = panel.current?.closest<HTMLElement>('.app-frame');
    frame?.style.setProperty('--preferred-right-width', `${preferred}px`);
  }, [preferred, panel]);
  useEffect(() => {
    const el = panel.current, frame = el?.closest<HTMLElement>('.app-frame'), reader = frame?.querySelector<HTMLElement>('.reader-column');
    if (!el || !frame || !reader) return;
    const update = () => {
      const max = clampPanelWidth(frame.getBoundingClientRect().right - reader.getBoundingClientRect().left - 320);
      const current = Math.round(el.getBoundingClientRect().width);
      el.dataset.density = panelDensity(current, el.dataset.density as PanelDensity | undefined);
      setBounds(previous => previous.max === max && previous.current === current ? previous : { max, current });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el); observer?.observe(reader); window.addEventListener('resize', update); update();
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); frame.classList.remove('panel-resizing'); };
  }, [panel]);
  const persist = (value: number) => { try { localStorage.setItem(KEY, String(value)); } catch { /* retain session preference */ } };
  const finish = (cancelled = false) => {
    if (!drag.current) return;
    const collapse = !cancelled && drag.current.collapse;
    if (cancelled || collapse) { setPreferred(drag.current.preferred); if (collapse) persist(drag.current.preferred); }
    else persist(latest.current);
    if (panel.current) delete panel.current.dataset.collapsePending;
    if (collapse) onCollapse?.();
    drag.current = null; panel.current?.closest('.app-frame')?.classList.remove('panel-resizing');
  };
  return <div className="panel-resize-handle" role="separator" aria-label="调整知识贴宽度" aria-orientation="vertical" aria-controls="knowledge-panel" aria-valuemin={220} aria-valuemax={bounds.max} aria-valuenow={Math.max(220, bounds.current)} tabIndex={0} title="拖动调整宽度；方向键微调，Enter 恢复默认；继续向内拖动可收起"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); onStart(); event.currentTarget.focus();
      drag.current = { x: event.clientX, width: panel.current?.getBoundingClientRect().width ?? preferred, preferred, collapse: false };
      event.currentTarget.setPointerCapture(event.pointerId); panel.current?.closest('.app-frame')?.classList.add('panel-resizing');
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      const raw = drag.current.width + drag.current.x - event.clientX;
      drag.current.collapse = raw <= 172;
      if (panel.current) panel.current.dataset.collapsePending = String(drag.current.collapse);
      setPreferred(clampPanelWidth(raw, bounds.max));
    }}
    onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); finish(true); return; }
      const value = event.key === 'ArrowLeft' ? bounds.current + 16 : event.key === 'ArrowRight' ? bounds.current - 16 : event.key === 'Home' ? 220 : event.key === 'End' ? bounds.max : event.key === 'Enter' ? 404 : null;
      if (value === null) return;
      event.preventDefault(); event.stopPropagation(); onStart();
      const next = clampPanelWidth(value, bounds.max); setPreferred(next); persist(next);
    }}/>;
}
