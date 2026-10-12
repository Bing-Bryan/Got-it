import {X_PUBLIC_SCOPE} from "./lib/x-article-url";
import {X_CAPTURE_EXTRACTOR, X_CAPTURE_SCOPE} from "./lib/x-article-capture";
import {confidentlyChinese} from "./lib/translation-policy";
import { useId, useMemo, useRef, useState } from "react";
import { Languages } from "lucide-react";
import { buildTranslationSource, TRANSLATION_PLACEHOLDER } from "./lib/web-translation";
import type { Workspace } from "./types";
import type { useReadingLibrary } from "./useReadingLibrary";

export function WebTranslationControls({workspace,library,onSide,saveStatus}:{workspace:Workspace;library:ReturnType<typeof useReadingLibrary>;onSide:(side:"original"|"translated")=>void;saveStatus?:string}) {
  const [permission,setPermission]=useState(false);
  const [options,setOptions]=useState(false);
  const [autoChoice,setAutoChoice]=useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const sourceDescriptionId = useId();
  const canTranslate = useMemo(() => {
    if (workspace.document.kind !== "web") return false;
    const units = buildTranslationSource(workspace.document.markdown, workspace.document.web).units;
    return units.length > 0 && !confidentlyChinese(units.map(unit => unit.text.replace(TRANSLATION_PLACEHOLDER, "")).join("\n"));
  }, [workspace.document]);
  if(workspace.document.kind!=="web")return null;
  const excerpt=workspace.document.web.coverage==="public-excerpt";
  const sourceFacts = `${workspace.document.web.retrieval?.provider === "fxtwitter" ? X_PUBLIC_SCOPE : workspace.document.web.extractorVersion === X_CAPTURE_EXTRACTOR ? X_CAPTURE_SCOPE : "正在阅读本机保存副本"} · 导入于 ${new Date(workspace.document.importedAt).toLocaleString()}${excerpt ? " · 仅保存公开部分，付费内容未导入" : ""}`;
  const state=workspace.webTranslation, disabled=library.readOnly || !library.ready;
  const hasTranslation = !!state && Object.values(state.units).some(text => text.trim().length > 0);
  const translated = workspace.readingSide === "translated";
  const partial = !!state && state.status !== "complete";
  const sideLabel = translated ? `切换到原文${partial ? "（当前为部分中文译文）" : ""}` : `切换到中文译文${partial ? "（部分）" : ""}`;
  const actionLabel = library.translationRunning ? "停止翻译" : hasTranslation ? partial ? "查看部分译文与继续译中" : sideLabel : state ? "继续译中" : "翻译为中文";
  const currentSaveStatus = saveStatus ?? library.status;
  const publicMissing=workspace.document.web.extractorVersion==='x-fxtwitter-public-v1'?workspace.document.web.media.filter(m=>m.status!=='saved').length:0;
  const status = publicMissing && /^(?:已保存|正文已保存)/.test(currentSaveStatus) ? `正文已保存到本机，${publicMissing}张图片未保存` : currentSaveStatus.startsWith("已保存") ? "已保存" : currentSaveStatus.startsWith("保存中") ? "保存中" : currentSaveStatus;
  const progress = library.translationProgress;
  const translationStatus = progress === "全文译中已保存" || progress === "已保存公开正文译中已保存" ? "" : progress || (state?.status !== "complete" ? state?.error : "");
  const closePanel = () => { setPermission(false); setOptions(false); trigger.current?.focus(); };
  const switchSide = () => { onSide(translated ? "original" : "translated"); closePanel(); };
  return <section className="web-translation-controls" aria-label="网页正文翻译" onKeyDown={event => { if (event.key === "Escape" && (permission || options)) { event.stopPropagation(); closePanel(); } }}>
    <div className="translation-toolbar">
      <a className="translation-source" href={workspace.document.web.originalUrl} target="_blank" rel="noopener noreferrer" title={sourceFacts} aria-describedby={sourceDescriptionId}>打开原网页</a><span id={sourceDescriptionId} className="translation-source-description">{sourceFacts}</span>
      <div className="translation-actions">
        {canTranslate || state || library.translationRunning ? <button ref={trigger} type="button" className="translation-side-toggle" aria-label={actionLabel} title={actionLabel} aria-pressed={translated} aria-expanded={hasTranslation && !partial && !library.translationRunning ? undefined : permission || options} aria-controls={permission || options ? panelId : undefined} disabled={!library.translationRunning && !hasTranslation && disabled} onClick={() => {
          if (library.translationRunning) { library.stopTranslation(); closePanel(); }
          else if (hasTranslation) { if (partial) { setPermission(false); setOptions(value => !value); } else switchSide(); }
          else if (state) void library.translate();
          else { setAutoChoice(library.autoTranslate); setOptions(false); setPermission(value => !value); }
        }}><Languages size={18} strokeWidth={1.8} aria-hidden="true" focusable="false" /></button> : null}
        {excerpt ? <span className="translation-scope-warning" role="status">仅保存公开部分，付费内容未导入。</span> : null}
      </div>
      {translationStatus ? <span className="translation-progress" role="status">{translationStatus}</span> : null}
      {status ? <span className="translation-status" role="status">{status}</span> : null}
    </div>
    {options && !library.translationRunning ? <div id={panelId} className="translation-options" role="group" aria-label="部分译文操作"><button type="button" onClick={switchSide}>{sideLabel}</button><button type="button" disabled={disabled} onClick={() => { closePanel(); void library.translate(); }}>继续译中</button></div> : null}
    {permission && !library.translationRunning ? <div id={panelId} className="translation-permission" role="group" aria-label="网页正文翻译授权"><p>{excerpt?"将已保存公开部分的全部可翻译正文分批发送给当前 AI，生成中文译文，不包含原站付费内容。":"将全部可翻译正文分批发送给当前 AI，生成中文译文。"}代码、URL和图片不发送，原文保留。</p><label><input type="checkbox" checked={autoChoice} onChange={event=>setAutoChoice(event.target.checked)}/>以后自动翻译确认加入的新英文网页</label><div><button type="button" disabled={disabled} onClick={()=>{closePanel();library.setAutoTranslation(autoChoice);void library.translate();}}>开始译中</button><button type="button" onClick={closePanel}>取消</button></div></div>:null}
    {!permission && library.autoTranslate?<label><input type="checkbox" checked onChange={()=>library.setAutoTranslation(false)}/>自动翻译新加入英文网页（可关闭）</label>:null}
    {workspace.document.web.extractorVersion !== 'x-fxtwitter-public-v1' && workspace.document.web.media.some(media => media.status !== "saved") ? <p className="translation-media-warning" role="status">部分图片／图表未导入</p> : null}
    {workspace.translationNotice?<p role="alert">{workspace.translationNotice}</p>:null}
  </section>;
}
