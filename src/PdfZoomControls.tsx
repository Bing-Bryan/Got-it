import { useReadingAdjustment } from './useReadingAdjustment';
import { useId, useRef, useState, type CSSProperties } from 'react';
import { RotateCcw, MoveDiagonal } from 'lucide-react';
import { clampZoom, sliderZoom, zoomSlider } from './usePdfZoom';

export function PdfZoomControls({ scale, automatic, onChange }: { scale: number; automatic: boolean; onChange: (value: number | null) => void }) {
  const panelId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const { root: ref, open, close, triggerClick, events } = useReadingAdjustment();
  const trigger = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  const percent = Math.round(scale * 100);
  const commit = () => {
    if (cancelled.current || draft === null) { setDraft(null); return; }
    const text = draft.trim().replace(/%$/, '');
    if (/^\d+(\.\d+)?$/.test(text)) onChange(clampZoom(Number(text) / 100));
    setDraft(null);
  };
  return <div {...events} ref={ref} className={`reading-adjustment pdf-zoom-controls${open ? ' is-open' : ''}`} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelled.current = true; setDraft(null); close(); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="reading-adjustment-trigger pdf-zoom-trigger" title="页面缩放" aria-controls={panelId} aria-label={`调整原文缩放，当前 ${percent}%${automatic ? '，自动适配' : ''}`} aria-expanded={open} onClick={triggerClick}><MoveDiagonal size={18} strokeWidth={1.8} aria-hidden="true"/></button>
    <div id={panelId} hidden={!open} className="reading-adjustment-fields pdf-zoom-fields" role="group" aria-label="原文缩放">
      <span className="reading-adjustment-label pdf-zoom-label" title={automatic ? '自动适配阅读宽度' : '手动比例'}>页面缩放</span>
      <input className="pdf-zoom-slider" style={{'--zoom-progress': `${zoomSlider(scale) / 10}%`} as CSSProperties} type="range" min="0" max="1000" step="1" value={zoomSlider(scale)} aria-label="原文缩放" aria-valuetext={`${percent}%${automatic ? '，自动适配' : ''}`} onChange={e => onChange(sliderZoom(Number(e.target.value)))} />
      <label className="pdf-zoom-value"><input aria-label="原文缩放百分比" inputMode="decimal" value={draft ?? percent} onFocus={e => { cancelled.current = false; setDraft(String(percent)); e.target.select(); }} onChange={e => { cancelled.current = false; setDraft(e.target.value); }} onBlur={commit} onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
      }}/><span>%</span></label>
      <button type="button" className="pdf-zoom-reset" aria-label="恢复自动适配" title="恢复自动适配" disabled={automatic} onClick={() => { setDraft(null); onChange(null); }}><RotateCcw size={14}/></button>
    </div>
  </div>;
}
