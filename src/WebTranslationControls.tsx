import { useState } from "react";
import { Languages } from "lucide-react";
import type { Workspace } from "./types";
import type { useReadingLibrary } from "./useReadingLibrary";
export function WebTranslationControls({workspace,library,onSide,saveStatus}:{workspace:Workspace;library:ReturnType<typeof useReadingLibrary>;onSide:(side:"original"|"translated")=>void;saveStatus?:string}) {
  const [permission,setPermission]=useState(false);
  const [autoChoice,setAutoChoice]=useState(false);
  if(workspace.document.kind!=="web")return null;
  const excerpt=workspace.document.web.coverage==="public-excerpt";
  const fullLabel=excerpt?"已保存公开正文译中":"全文译中";
  const state=workspace.webTranslation, disabled=library.readOnly || !library.ready;
  const hasTranslation = state && Object.values(state.units).some(text => text.trim().length > 0);
  const translated = workspace.readingSide === "translated";
  const partial = state && state.status !== "complete";
  const sideLabel = translated
    ? `切换到原文${partial ? "（当前为部分中文译文）" : ""}`
    : `切换到中文译文${partial ? "（部分）" : ""}`;
  const currentSaveStatus = saveStatus ?? library.status;
  const status = currentSaveStatus.startsWith("已保存") ? "已保存" : currentSaveStatus.startsWith("保存中") ? "保存中" : currentSaveStatus;
  // Translation progress and failures are separate from the one persistence status.
  // A completed translation never overrides a pending or failed save.
  const progress = library.translationProgress;
  const translationStatus = progress === "全文译中已保存" || progress === "已保存公开正文译中已保存" ? "" : progress || (state?.status !== "complete" ? state?.error : "");
  return <section className="web-translation-controls" aria-label="网页正文翻译">
    <div className="translation-toolbar">
    <a className="translation-source" href={workspace.document.web.originalUrl} target="_blank" rel="noopener noreferrer" title={`正在阅读本机保存副本 · 导入于 ${new Date(workspace.document.importedAt).toLocaleString()}`}>打开原网页</a>
    <div className="translation-actions">
    {hasTranslation ? <button type="button" className="translation-side-toggle" aria-label={sideLabel} title={sideLabel} aria-pressed={translated} onClick={()=>onSide(translated ? "original" : "translated")}><Languages size={18} strokeWidth={1.8} aria-hidden="true" focusable="false" /></button>:null}
    {excerpt ? <span className="translation-scope-warning" role="status">仅保存公开部分，付费内容未导入。</span> : null}
    {library.translationRunning ? <button type="button" onClick={library.stopTranslation}>停止翻译</button>:state?.status!=="complete"?<button type="button" disabled={disabled} onClick={()=>state?void library.translate():(setAutoChoice(library.autoTranslate),setPermission(true))}>{state?"继续译中":fullLabel}</button>:null}</div>
    {translationStatus ? <span className="translation-progress" role="status">{translationStatus}</span> : null}
    {status ? <span className="translation-status" role="status">{status}</span> : null}
    </div>
    {permission ? <div className="translation-permission" role="group" aria-label={excerpt ? "已保存公开正文翻译授权" : "全文翻译授权"}><p>{excerpt?"将已保存的公开英文正文分批发送给当前 AI，不包含原站付费内容。":"将全部可翻译的英文正文分批发送给当前 AI，生成中文译文。"}代码、URL和图片不发送，原文保留。</p><label><input type="checkbox" checked={autoChoice} onChange={event=>setAutoChoice(event.target.checked)}/>以后自动翻译确认加入的新英文网页</label><div><button type="button" onClick={()=>{setPermission(false);library.setAutoTranslation(autoChoice);void library.translate();}}>开始译中</button><button type="button" onClick={()=>setPermission(false)}>取消</button></div></div>:null}
    {!permission && library.autoTranslate?<label><input type="checkbox" checked onChange={()=>library.setAutoTranslation(false)}/>自动翻译新加入英文网页（可关闭）</label>:null}
    {workspace.document.web.media.some(media => media.status !== "saved") ? <p className="translation-media-warning" role="status">部分图片／图表未导入</p> : null}
    {workspace.translationNotice?<p role="alert">{workspace.translationNotice}</p>:null}
  </section>;
}
