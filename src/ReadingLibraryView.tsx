import { Copy, Check } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { useReadingLibrary } from "./useReadingLibrary";
import { ReadingRecoveryView } from "./ReadingRecoveryView";
type Library = ReturnType<typeof useReadingLibrary>;
export function ReadingLibraryNavigation({ library, importCopy }: { library: Library; importCopy: () => void }) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<{ id: string; ok: boolean } | null>(null);
  async function copyPath(id: string, path: string) {
    try { await navigator.clipboard.writeText(path); setCopyStatus({ id, ok: true }); }
    catch { setCopyStatus({ id, ok: false }); }
  }
  const holder = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popupId = useId();
  const entries = useMemo(() => [...library.list.entries].sort((a, b) => a.filename.localeCompare(b.filename, "zh-CN", { numeric: true }) || (a.path ?? "").localeCompare(b.path ?? "") || a.id.localeCompare(b.id)), [library.list.entries]);
  const disabled = !library.ready || library.busy;
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!holder.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <section className="reading-library" aria-label="阅读材料">
    <div className="library-add-actions">
      <button type="button" className="library-add" disabled={disabled} onClick={() => library.list.nativePicker ? void library.choose() : importCopy()}>＋ 添加文件</button>
      <div className="library-switcher" ref={holder}
        onPointerEnter={event => { if (event.pointerType !== "touch") setOpen(true); }}
        onPointerLeave={() => { if (!holder.current?.contains(document.activeElement)) setOpen(false); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
        <button ref={trigger} type="button" className="library-current" aria-label={`切换文件：${library.entry?.workspace.document.filename ?? "选择文件"}`} aria-expanded={open} aria-controls={popupId}
          onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => holder.current?.querySelector<HTMLButtonElement>(".library-open")?.focus()); } }}>
          <span>{library.entry?.workspace.document.filename ?? "选择文件"}</span><span aria-hidden="true">▸</span>
        </button>
        {open ? <div className="library-popup" id={popupId} aria-label="切换阅读文件">
          <div className="library-items">{entries.length ? entries.map(e => <div className={`library-item ${library.entry?.id === e.id ? "current" : ""}`} key={e.id}>
            <div className="library-title"><button className="library-open" type="button" disabled={disabled} aria-current={library.entry?.id === e.id ? "page" : undefined} onClick={() => { setOpen(false); void library.open(e.id); }}>{e.filename}</button>
            {library.recoveries.filter(r=>(r.entryId === e.id || r.resultEntryId === e.id) && r.state === "pending" && r.hasDifferences !== false).map(r=><button key={r.id} type="button" className="library-recovery-link" disabled={library.busy} onClick={()=>{setOpen(false);void library.showRecovery(r.id);}}>{r.state === "pending" ? "查看待核对差异" : "查看记录差异"}</button>)}

            </div>
            {e.path ? <div className="library-path">
              <button className="library-copy-path" type="button" aria-label={`复制路径：${e.filename}`} onClick={() => void copyPath(e.id, e.path!)}><span>{e.path}</span>{copyStatus?.id === e.id && copyStatus.ok ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button>
              {copyStatus?.id === e.id ? <small role="status">{copyStatus.ok ? "路径已复制" : "复制失败，请选中路径手动复制"}</small> : null}
            </div> : <span className="library-no-path">未关联原文件</span>}
          </div>) : <p className="nav-empty">还没有文件，先添加一篇文章。</p>}</div>
        </div> : null}
      </div>
    </div>
    {library.list.warnings.map((warning,i) => <p key={i} role="alert" className="library-warning">{warning}</p>)}
  </section>;
}
export function ReadingLibraryStatus({ library }: { library: Library }) {
  const sourceStatus = library.check?.status;
  const sourceProblem = !!sourceStatus && sourceStatus !== "available";
  const cannotRead = sourceStatus === "missing" || sourceStatus === "permission" || sourceStatus === "unreadable" || sourceStatus === "reselect";
  return <div className="library-state">
    {library.error ? <div role="alert" className="library-warning">{library.error} <button type="button" disabled={library.busy} onClick={() => void library.retry()}>重试保存</button></div> : null}
    {library.blocked || library.status === "阅读进度暂未保存" ? <p className="library-warning">须先保存阅读记录才能离开，当前内容仍保留。</p> : null}
    {library.draftWarning ? <p role="alert" className="library-warning">{library.draftWarning}</p> : null}
    {library.notice ? <p role="status" className="library-recovered">{library.notice}</p> : null}
    {library.recoveries.filter(r=>r.state === 'pending' && r.savedRecordUnavailable).map(r=><div key={r.id} className="library-warning" role="alert"><span>{r.filename}：当前保存记录无法读取，之前的记录已保留。</span><button type="button" disabled={library.busy} onClick={()=>void library.showRecovery(r.id)}>找回阅读记录</button></div>)}
    <ReadingRecoveryView library={library} />
    {library.entry && (sourceProblem || library.entry.history.length > 0) ? <div className="library-source-state">
      {sourceProblem ? <span>{library.check?.message}</span> : null}
      {cannotRead ? <button type="button" disabled={library.busy || library.readOnly} onClick={() => void library.checkSource()}>重试读取</button> : null}
      {(cannotRead || sourceStatus === "unlinked") && library.list.nativePicker ? <button type="button" disabled={library.busy || library.readOnly} onClick={() => void library.choose(true)}>{library.entry.source ? "重新定位" : "关联原文件"}</button> : null}
      {library.check?.status === "changed" ? <><span>可继续阅读保存版本，或</span><button type="button" disabled={library.busy || library.readOnly} onClick={() => void library.acceptUpdate()}>使用更新后的原文</button></> : null}
      {library.entry.history.length ? <label>阅读版本 <select aria-label="阅读版本" value={library.historyId} disabled={library.busy || !!library.recovery} onChange={event => void library.viewRevision(event.target.value)}><option value="">当前版本</option>{library.entry.history.map((r,i) => <option value={r.id} key={r.id}>之前的阅读版本 {i+1} · {new Date(r.savedAt).toLocaleString()}</option>)}</select></label> : null}
      {library.historyId ? <strong>旧版本只读，可查看原文和知识贴。</strong> : null}
    </div> : null}
  </div>;
}
