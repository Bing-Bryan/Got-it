import {X_PUBLIC_SCOPE} from "./lib/x-article-url";
import {X_CAPTURE_EXTRACTOR, X_CAPTURE_SCOPE} from "./lib/x-article-capture";
import {confidentlyChinese} from "./lib/translation-policy";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Languages } from "lucide-react";
import { buildTranslationSource, friendlyTranslationError, validUnitTranslation, TRANSLATION_PLACEHOLDER } from "./lib/web-translation";
import type { Workspace } from "./types";
import type { TranslationActivity, useReadingLibrary } from "./useReadingLibrary";

const unitExplanation = "文本块包括标题、段落、列表项和表格单元格；长段落可能拆成多个块。代码、URL和图片不计入可翻译文字。每批结果通过校验后，已翻译数量才会增加；等待时间不代表完成进度。";

function TranslationCountHelp({completed,total}:{completed:number;total:number}) {
  const id=useId(),trigger=useRef<HTMLSpanElement>(null),tooltip=useRef<HTMLSpanElement>(null);
  const [visible,setVisible]=useState(false);
  const hideTimer=useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide=()=>{if(hideTimer.current){clearTimeout(hideTimer.current);hideTimer.current=null;}};
  const [position,setPosition]=useState({left:12,top:0});
  const place=() => {
    const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
    const width=Math.min(320,window.innerWidth-24);
    setPosition({left:Math.max(12,Math.min(rect.left+(rect.width-width)/2,window.innerWidth-width-12)),top:rect.bottom+8});
  };
  const show=() => {cancelHide();place();setVisible(true);};
  const leave=(event:React.MouseEvent) => {
    const target=event.relatedTarget;
    if(target instanceof Node && (trigger.current?.contains(target)||tooltip.current?.contains(target)))return;
    if(document.activeElement!==trigger.current){cancelHide();hideTimer.current=setTimeout(()=>{hideTimer.current=null;setVisible(false);},120);}
  };
  useEffect(() => {
    if(!visible)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){cancelHide();setVisible(false);}};
    window.addEventListener("keydown",escape);
    window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
    return()=>{window.removeEventListener("keydown",escape);window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};
  },[visible]);
  useEffect(()=>()=>cancelHide(),[]);
  return <span className="translation-count-help">
    <span ref={trigger} className="translation-count" tabIndex={0} aria-describedby={id} onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={()=>setVisible(false)} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();setVisible(false);}}}>已翻译 {completed} / {total} 个文本块</span>
    {createPortal(<span ref={tooltip} id={id} role="tooltip" hidden={!visible} className="translation-count-tooltip" style={position} onMouseEnter={show} onMouseLeave={leave}>{unitExplanation}</span>,document.body)}
  </span>;
}

function RunningTranslationProgress({activity}:{activity:TranslationActivity}) {
  const [now,setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()),1000);
    return () => clearInterval(timer);
  },[activity.startedAt]);
  const seconds = Math.max(0,Math.floor((now-activity.startedAt)/1000));
  const batchSeconds = Math.max(0,Math.floor((now-activity.phaseStartedAt)/1000));
  const phase = activity.phase === "waiting" ? "等待本批返回" : activity.phase === "saving" ? "正在保存译文" : "正在准备本批";
  return <div className="translation-live-progress">
    <TranslationCountHelp completed={activity.completed} total={activity.total}/>
    <span className="translation-phase" role="status" aria-atomic="true">{phase}</span>
    <span className="translation-wait-time" aria-live="off">已等待 {seconds} 秒{activity.phase === "waiting" && batchSeconds >= 30 ? " · 仍未收到本批结果" : ""}</span>
  </div>;
}

export function WebTranslationControls({workspace,library,onSide,saveStatus}:{workspace:Workspace;library:ReturnType<typeof useReadingLibrary>;onSide:(side:"original"|"translated")=>void;saveStatus?:string}) {
  const [permission,setPermission]=useState(false);
  const [autoChoice,setAutoChoice]=useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const sourceDescriptionId = useId();
  const source = useMemo(() => workspace.document.kind === "web" ? buildTranslationSource(workspace.document.markdown,workspace.document.web) : null,[workspace.document]);
  const canTranslate = !!source?.units.length && !confidentlyChinese(source.units.map(unit => unit.text.replace(TRANSLATION_PLACEHOLDER, "")).join("\n"));
  if(workspace.document.kind!=="web")return null;
  const excerpt=workspace.document.web.coverage==="public-excerpt";
  const sourceFacts = `${workspace.document.web.retrieval?.provider === "fxtwitter" ? X_PUBLIC_SCOPE : workspace.document.web.extractorVersion === X_CAPTURE_EXTRACTOR ? X_CAPTURE_SCOPE : "正在阅读本机保存副本"} · 导入于 ${new Date(workspace.document.importedAt).toLocaleString()}${excerpt ? " · 仅保存公开部分，付费内容未导入" : ""}`;
  const state=workspace.webTranslation, disabled=library.readOnly || !library.ready;
  const hasTranslation = !!state && Object.values(state.units).some(text => text.trim().length > 0);
  const translated = workspace.readingSide === "translated";
  const partial = !!state && state.status !== "complete";
  const sideLabel = translated ? `切换到原文${partial ? "（当前为部分中文译文）" : ""}` : `切换到中文译文${partial ? "（部分）" : ""}`;
  const actionLabel = library.translationRunning ? "停止翻译" : hasTranslation ? sideLabel : "翻译为中文";
  const completed = source?.units.filter(unit => validUnitTranslation(unit,state?.units[unit.id])).length ?? 0;
  const total = source?.units.length ?? 0;
  const idleIncomplete = !!state && partial && !library.translationRunning;
  const resumeLabel = completed === total ? "重试保存译文" : "继续翻译";
  const resumeDescription = completed === total ? "只保存已有译文，不重新生成。" : "仅翻译未完成的文本块，保留已有译文、原文和知识贴。";
  const currentSaveStatus = saveStatus ?? library.status;
  const publicMissing=workspace.document.web.extractorVersion==='x-fxtwitter-public-v1'?workspace.document.web.media.filter(m=>m.status!=='saved').length:0;
  const status = publicMissing && /^(?:已保存|正文已保存)/.test(currentSaveStatus) ? `正文已保存到本机，${publicMissing}张图片未保存` : currentSaveStatus.startsWith("已保存") ? "已保存" : currentSaveStatus.startsWith("保存中") ? "保存中" : currentSaveStatus;
  const progress = library.translationProgress;
  const rawTranslationStatus = progress === "全文译中已保存" || progress === "已保存公开正文译中已保存" ? "" : progress || (state?.status !== "complete" ? state?.error : "");
  const translationStatus = friendlyTranslationError((idleIncomplete ? rawTranslationStatus?.replace(/^已翻译 \d+ \/ \d+ 个文本块；/, "") : rawTranslationStatus)??"");
  const closePanel = () => { setPermission(false); trigger.current?.focus(); };
  const switchSide = () => { onSide(translated ? "original" : "translated"); closePanel(); };
  return <section className="web-translation-controls" aria-label="网页正文翻译" onKeyDown={event => { if (event.key === "Escape" && permission) { event.stopPropagation(); closePanel(); } }}>
    <div className="translation-toolbar">
      <a className="translation-source" href={workspace.document.web.originalUrl} target="_blank" rel="noopener noreferrer" title={sourceFacts} aria-describedby={sourceDescriptionId}>打开原网页</a><span id={sourceDescriptionId} className="translation-source-description">{sourceFacts}</span>
      <div className="translation-actions">
        {hasTranslation || (!state && canTranslate) || library.translationRunning ? <button ref={trigger} type="button" className={`translation-side-toggle${library.translationRunning ? " translation-stop" : ""}`} aria-label={actionLabel} title={actionLabel} aria-pressed={translated} aria-expanded={hasTranslation || library.translationRunning ? undefined : permission} aria-controls={permission ? panelId : undefined} disabled={!library.translationRunning && !hasTranslation && disabled} onClick={() => {
          if (library.translationRunning) { library.stopTranslation(); closePanel(); }
          else if (hasTranslation) switchSide();
          else { setAutoChoice(library.autoTranslate); setPermission(value => !value); }
        }}><Languages size={18} strokeWidth={1.8} aria-hidden="true" focusable="false" />{library.translationRunning ? <span>停止翻译</span> : null}</button> : null}
        {idleIncomplete ? <button type="button" className="translation-resume" disabled={disabled} title={resumeDescription} aria-description={resumeDescription} onClick={()=>void library.translate()}>{resumeLabel}</button> : null}
        {excerpt ? <span className="translation-scope-warning" role="status">仅保存公开部分，付费内容未导入。</span> : null}
      </div>
      {idleIncomplete ? <TranslationCountHelp completed={completed} total={total}/> : null}
      {library.translationRepairCount>0 && <span className="translation-progress" role="status">已修复 {library.translationRepairCount} 块排版</span>}
      {library.translationRunning && library.translationActivity ? <RunningTranslationProgress activity={library.translationActivity}/> : translationStatus ? <span className="translation-progress" role="status">{translationStatus}</span> : null}
      {status ? <span className="translation-status" role="status">{status}</span> : null}
    </div>
    {permission && !library.translationRunning ? <div id={panelId} className="translation-permission" role="group" aria-label="网页正文翻译授权"><p>{excerpt?"将已保存公开部分的全部可翻译正文分批发送给当前 AI，生成中文译文，不包含原站付费内容。":"将全部可翻译正文分批发送给当前 AI，生成中文译文。"}代码、URL和图片不发送，原文保留。</p><label><input type="checkbox" checked={autoChoice} onChange={event=>setAutoChoice(event.target.checked)}/>以后自动翻译确认加入的新英文网页</label><div><button type="button" disabled={disabled} onClick={()=>{closePanel();library.setAutoTranslation(autoChoice);void library.translate();}}>开始译中</button><button type="button" onClick={closePanel}>取消</button></div></div>:null}
    {!permission && library.autoTranslate?<label><input type="checkbox" checked onChange={()=>library.setAutoTranslation(false)}/>自动翻译新加入英文网页（可关闭）</label>:null}
    {workspace.document.web.extractorVersion !== 'x-fxtwitter-public-v1' && workspace.document.web.media.some(media => media.status !== "saved") ? <p className="translation-media-warning" role="status">部分图片／图表未导入</p> : null}
    {workspace.translationNotice?<p role="alert">{workspace.translationNotice}</p>:null}
  </section>;
}
