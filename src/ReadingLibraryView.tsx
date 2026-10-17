import {HOSTED} from './lib/runtime-mode';
import {HostedStorageControls,HostedSampleAttribution} from './HostedControls';
import {X_PUBLIC_SCOPE} from "./lib/x-article-url";
import {X_CAPTURE_EXTRACTOR, X_CAPTURE_SCOPE} from "./lib/x-article-capture";
import { Copy, Check, Plus, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { useReadingLibrary } from "./useReadingLibrary";
import { ReadingRecoveryView } from "./ReadingRecoveryView";
import { WebImportDialog } from "./WebImportDialog";
import { searchLibraryNames } from "./lib/library-name-search";
type Library = ReturnType<typeof useReadingLibrary>;
export function ReadingLibraryNavigation({ library, importCopy }: { library: Library; importCopy: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const focusSearchOnOpen = useRef(false);
  function closePopup() { setOpen(false); setQuery(""); }
  function openSearch() {
    focusSearchOnOpen.current = true;
    if (searchInput.current) { searchInput.current.focus(); focusSearchOnOpen.current = false; }
    setOpen(true);
  }
  useLayoutEffect(() => {
    if (open && focusSearchOnOpen.current) { searchInput.current?.focus(); focusSearchOnOpen.current = false; }
  }, [open]);
  const [addOpen, setAddOpen] = useState(false);
  const addHolder = useRef<HTMLDivElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const addId = useId();
  const [copyStatus, setCopyStatus] = useState<{ id: string; ok: boolean } | null>(null);
  async function copyPath(id: string, path: string) {
    try { await navigator.clipboard.writeText(path); setCopyStatus({ id, ok: true }); }
    catch { setCopyStatus({ id, ok: false }); }
  }
  const holder = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popupId = useId();
  const entries = useMemo(() => searchLibraryNames(library.list.entries, query), [library.list.entries, query]);
  const disabled = !library.ready || library.busy;
  useEffect(()=>{if(disabled)setAddOpen(false);},[disabled]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!holder.current?.contains(event.target as Node)) closePopup(); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (!addOpen) return;
    const close = (event: PointerEvent) => { if (!addHolder.current?.contains(event.target as Node)) setAddOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [addOpen]);
  return <section className="reading-library" aria-label="阅读材料">
    <div className="library-add-actions">
      <div className="library-add-menu" ref={addHolder} onMouseEnter={()=>{if(!disabled)setAddOpen(true);}} onMouseLeave={()=>setAddOpen(false)} onFocus={event=>{if(!disabled&&!event.currentTarget.contains(event.relatedTarget))setAddOpen(true);}} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAddOpen(false); }} onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); setAddOpen(false); addTrigger.current?.focus(); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && addOpen) {
          event.preventDefault(); const buttons = [...(addHolder.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length-1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }}>
        <button ref={addTrigger} type="button" className="library-add" aria-label="添加阅读材料" disabled={disabled} aria-haspopup="menu" aria-expanded={addOpen} aria-controls={addId} onClick={() => setAddOpen(true)} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setAddOpen(true); requestAnimationFrame(() => addHolder.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()); } }}><Plus size={18} strokeWidth={2} aria-hidden="true" focusable="false" /></button>
        {addOpen ? <div className="library-add-options" role="menu" id={addId} aria-label="添加阅读材料">
          <button type="button" role="menuitem" disabled={disabled} onClick={() => { if(disabled)return; setAddOpen(false); addTrigger.current?.focus(); if (library.list.nativePicker) void library.choose(); else importCopy(); }}><span>本地文件</span><small>MD / PDF</small></button>
          <button type="button" role="menuitem" disabled={disabled} onClick={() => { if(disabled)return; setAddOpen(false); addTrigger.current?.focus(); library.showWebImport(); }}><span>网页链接</span><small>静态文章 / X</small></button>
        </div> : null}
      </div>
      <div className="library-switcher" ref={holder}
        onPointerEnter={event => { if (event.pointerType !== "touch") setOpen(true); }}
        onPointerLeave={() => { if (!holder.current?.contains(document.activeElement)) closePopup(); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closePopup(); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.stopPropagation(); closePopup(); trigger.current?.focus(); }
          if (open && ["ArrowDown", "ArrowUp"].includes(event.key) && (event.target === searchInput.current || (event.target as HTMLElement).matches(".library-open"))) {
            event.preventDefault(); event.stopPropagation();
            const buttons = [...(holder.current?.querySelectorAll<HTMLButtonElement>(".library-open:not(:disabled)") ?? [])];
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            const next = index + (event.key === "ArrowDown" ? 1 : -1);
            if (next < 0) searchInput.current?.focus(); else buttons[Math.min(next, buttons.length - 1)]?.focus();
          }
        }}>
        <button ref={trigger} type="button" className="library-current" title={library.entry?.workspace.document.filename ?? "选择文件"} aria-label={`切换文件：${library.entry?.workspace.document.filename ?? "选择文件"}`} aria-expanded={open} aria-controls={popupId}
          onClick={openSearch} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); openSearch(); } }}>
          <span>{library.entry?.workspace.document.filename ?? "选择文件"}</span><ChevronDown size={13} className="disclosure-chevron" aria-hidden="true"/>
        </button>
        {open ? <div className="library-popup" id={popupId} aria-label="切换阅读文件">
          <div className="library-popup-panel">
          <div className="library-search"><input ref={searchInput} type="search" aria-label="搜索文件名称" placeholder="搜索文件名或网页标题" value={query} onChange={event => setQuery(event.target.value)} /></div>
          <div className="library-items">{entries.length ? entries.map(e => <div className={`library-item ${library.entry?.id === e.id ? "current" : ""}`} key={e.id}>
            <div className="library-title"><button className="library-open" type="button" disabled={disabled} aria-current={library.entry?.id === e.id ? "page" : undefined} onClick={() => { closePopup(); void library.open(e.id); }}>{e.filename}</button>
            {library.recoveries.filter(r=>(r.entryId === e.id || r.resultEntryId === e.id) && r.state === "pending" && r.hasDifferences !== false).map(r=><button key={r.id} type="button" className="library-recovery-link" disabled={library.busy} onClick={()=>{closePopup();void library.showRecovery(r.id);}}>{r.state === "pending" ? "查看待核对差异" : "查看记录差异"}</button>)}

            </div>
            {e.kind === "web" || e.url ? <div className="library-path"><div className="library-web-source"><a className="library-source-url" href={e.url} target="_blank" rel="noopener noreferrer">{e.url}</a><button type="button" className="library-copy-url" aria-label={`复制来源：${e.filename}`} onClick={() => void copyPath(e.id, e.url!)}>{copyStatus?.id === e.id && copyStatus.ok ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button></div>{copyStatus?.id === e.id ? <small role="status">{copyStatus.ok ? "来源已复制" : "复制失败，请选中链接手动复制"}</small> : null}</div> : e.path ? <div className="library-path">
              <button className="library-copy-path" type="button" aria-label={`复制路径：${e.filename}`} onClick={() => void copyPath(e.id, e.path!)}><span>{e.path}</span>{copyStatus?.id === e.id && copyStatus.ok ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button>
              {copyStatus?.id === e.id ? <small role="status">{copyStatus.ok ? "路径已复制" : "复制失败，请选中路径手动复制"}</small> : null}
            </div> : <span className="library-no-path">未关联原文件</span>}
          </div>) : <p className="nav-empty" role="status">{library.list.entries.length ? "没有匹配的文件名称" : "还没有文件，先添加一篇文章。"}</p>}</div>
          </div>
        </div> : null}
      </div>
    </div>
    <WebImportDialog library={library} />
    {library.list.warnings.map((warning,i) => <p key={i} role="alert" className="library-warning">{warning}</p>)}
  </section>;
}
export function ReadingLibraryStatus({ library, onImport, hideWebSource = false }: { library: Library; onImport?: () => void; hideWebSource?: boolean }) {
  const webDoc = library.entry?.workspace?.document.kind === "web" ? library.entry.workspace.document : null;
  const sourceStatus = webDoc ? undefined : library.check?.status;
  const sourceProblem = !!sourceStatus && sourceStatus !== "available";
  const cannotRead = sourceStatus === "missing" || sourceStatus === "permission" || sourceStatus === "unreadable" || sourceStatus === "reselect";
  const saveBlocked = library.blocked || library.status === "阅读进度暂未保存";
  const duplicateImportError = library.webImportOpen && library.webError && library.error === library.webError;
  return <div className="library-state">
    {HOSTED?<div className="hosted-library-controls"><HostedStorageControls save={()=>library.saveNow()} onRestore={()=>onImport?.()}/>{library.entry?<HostedSampleAttribution hash={library.entry.workspace.document.contentHash}/>:null}</div>:null}
    {((library.error && !duplicateImportError) || saveBlocked) && !library.recovery ? <div role="alert" className="library-warning"><span>{library.error}{saveBlocked ? <small>当前内容仍保留，保存成功后才能离开。</small> : null}</span>
      {saveBlocked || !library.ready ? <button type="button" disabled={library.busy} onClick={() => void library.retry()}>{saveBlocked ? "重试保存" : "重新连接"}</button> : library.importError && onImport ? <button type="button" disabled={library.busy} onClick={onImport}>重新选择文件</button> : <button type="button" disabled={library.busy} onClick={library.clearError}>关闭提示</button>}
    </div> : null}
    {library.draftWarning ? <p role="alert" className="library-warning">{library.draftWarning}</p> : null}
    {library.notice ? <p role="status" className="library-recovered">{library.notice}</p> : null}
    {library.recoveries.filter(r=>r.state === 'pending' && r.savedRecordUnavailable).map(r=><div key={r.id} className="library-warning" role="alert"><span>{r.filename}：当前保存记录无法读取，之前的记录已保留。</span><button type="button" disabled={library.busy} onClick={()=>void library.showRecovery(r.id)}>找回阅读记录</button></div>)}
    <ReadingRecoveryView library={library} />
    {webDoc && !hideWebSource ? <details key={webDoc.id} className="web-source-state"><summary>来源详情</summary><div className="web-source-details"><span>导入于 {new Date(webDoc.importedAt).toLocaleString()}</span><span>{webDoc.web.retrieval?.provider === "fxtwitter" ? X_PUBLIC_SCOPE : webDoc.web.extractorVersion === X_CAPTURE_EXTRACTOR ? X_CAPTURE_SCOPE : "正在阅读本机保存副本"}</span>{webDoc.web.retrieval?.provider === "fxtwitter" ? <a href={webDoc.web.retrieval.url} target="_blank" rel="noopener noreferrer">查看获取接口</a> : null}{webDoc.web.coverage === "public-excerpt" ? <span>仅保存公开部分，付费内容未导入</span> : null}<a href={webDoc.web.originalUrl} target="_blank" rel="noopener noreferrer">打开原网页</a></div></details> : null}
    {library.entry && (sourceProblem || library.entry.history.length > 0) ? <div className="library-source-state">
      {sourceProblem ? <span title={library.check?.message}>{sourceStatus === "unlinked" ? "阅读副本 · 未关联原文件" : library.check?.message}</span> : null}
      {cannotRead ? <button type="button" disabled={library.busy || library.readOnly} onClick={() => void library.checkSource()}>重试读取</button> : null}
      {(cannotRead || sourceStatus === "unlinked") && library.list.nativePicker ? <button type="button" disabled={library.busy || library.readOnly} onClick={() => void library.choose(true)}>{library.entry.source ? "重新定位" : "关联原文件"}</button> : null}
      {library.check?.status === "changed" ? <><span>可继续阅读保存版本，或</span><button type="button" disabled={library.busy || library.readOnly} onClick={() => void library.acceptUpdate()}>使用更新后的原文</button></> : null}
      {library.entry.history.length ? <label>阅读版本 <select aria-label="阅读版本" value={library.historyId} disabled={library.busy || !!library.recovery} onChange={event => void library.viewRevision(event.target.value)}><option value="">当前版本</option>{library.entry.history.map((r,i) => <option value={r.id} key={r.id}>之前的阅读版本 {i+1} · {new Date(r.savedAt).toLocaleString()}</option>)}</select></label> : null}
      {library.historyId ? <strong>旧版本只读，可查看原文和知识贴。</strong> : null}
    </div> : null}
  </div>;
}
