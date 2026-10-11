import { useEffect, useRef, useState } from "react";
import type { useReadingLibrary } from "./useReadingLibrary";

type Library = ReturnType<typeof useReadingLibrary>;
export function WebImportDialog({ library }: { library: Library }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);
  const [url, setUrl] = useState("");
  useEffect(() => { setUrl(""); }, [library.webImportSuccess]);
  const job = library.webJob;
  const reading = job?.status === "reading";
  const pending = reading || library.busy;
  useEffect(() => {
    if (!library.webImportOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current; if (!el) return;
    if (el.showModal) el.showModal(); else el.open = true;
    return () => { if (el.close) el.close(); else el.open = false; previous?.focus(); };
  }, [library.webImportOpen]);
  if (!library.webImportOpen) return null;
  function outside(event: React.MouseEvent | React.PointerEvent) {
    const el = dialog.current;
    if (!el || event.target !== el) return false;
    const rect = el.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  return <dialog ref={dialog} className="web-import-dialog" aria-labelledby="web-import-title"
    onPointerDown={event => { backdropDown.current = outside(event); }}
    onClick={event => { if (backdropDown.current && outside(event) && !library.busy) void library.cancelWebImport(true); backdropDown.current = false; }}
    onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); if (!library.busy) void library.cancelWebImport(true); }}>
    <header><div><h2 id="web-import-title">添加文章链接</h2><p>读取后保存到本机，并在当前阅读器打开。</p></div></header>
    <form className="web-import-form" onSubmit={event => { event.preventDefault(); void library.readWebArticle(url); }}>
      <label htmlFor="web-import-url">公开文章链接</label>
      <div><input id="web-import-url" type="url" value={url} placeholder="https://www.anthropic.com/research/…" autoComplete="off" autoFocus required disabled={pending} onChange={event => setUrl(event.target.value)} /><button type="submit" disabled={pending || !url.trim()}>{library.busy ? "正在保存…" : reading ? "正在读取…" : "阅读文章"}</button></div>
    </form>
    {library.webError ? <p role="alert" className="library-warning">{library.webError}</p> : job ? <p className="web-import-progress" role="status">{library.busy ? "正在保存文章，请稍候。保存完成前暂不能关闭。" : job.progress}</p> : null}
  </dialog>;
}
