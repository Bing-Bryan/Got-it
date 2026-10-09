import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { RotateCcw, MoveHorizontal } from 'lucide-react';
import { clampMarkdownWidth, DEFAULT_MARKDOWN_WIDTH } from './useMarkdownWidth';

export function MarkdownWidthControls({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const panelId = useId();
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const commit = () => {
    if (!cancelled.current && draft !== null && /^\d+(\.\d+)?%?$/.test(draft.trim())) onChange(clampMarkdownWidth(Number(draft.trim().replace(/%$/, ''))));
    setDraft(null);
  };
  return <div ref={root} className={`reading-adjustment markdown-width-controls${open ? ' is-open' : ''}`} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(null); setOpen(false); if (open) trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="reading-adjustment-trigger markdown-width-trigger" title="正文宽度" aria-controls={panelId} aria-expanded={open} aria-label={`调整正文宽度，当前 ${width}%`} onClick={() => setOpen(!open)}><MoveHorizontal size={18} strokeWidth={1.8} aria-hidden="true"/></button>
    <div id={panelId} hidden={!open} className="reading-adjustment-fields markdown-width-fields" role="group" aria-label="正文宽度设置">
      <span className="reading-adjustment-label markdown-width-label">正文宽度</span>
      <input className="markdown-width-slider" type="range" min="50" max="100" step="1" value={width} aria-label="正文宽度" aria-valuetext={`${width}%`} style={{'--width-progress': `${(width - 50) * 2}%`} as CSSProperties} onChange={e => onChange(Number(e.target.value))}/>
      <label className="markdown-width-value"><input aria-label="正文宽度百分比" inputMode="numeric" value={draft ?? width} onFocus={e => { cancelled.current = false; setDraft(String(width)); e.target.select(); }} onChange={e => { cancelled.current = false; setDraft(e.target.value); }} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}/><span>%</span></label>
      <button type="button" className="markdown-width-reset" aria-label="恢复默认正文宽度" title="恢复默认正文宽度" disabled={width === DEFAULT_MARKDOWN_WIDTH} onClick={() => { setDraft(null); onChange(DEFAULT_MARKDOWN_WIDTH); }}><RotateCcw size={14}/></button>
    </div>
  </div>;
}
