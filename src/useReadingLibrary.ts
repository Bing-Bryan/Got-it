import {sampleForFile} from './lib/hosted-sample-data';
import { documentTranslationSource } from "./lib/document-translation";
import { loadPdfTranslationSource } from "./lib/pdf-translation-loader";
import { confidentlyChinese } from "./lib/translation-policy";
import {HOSTED} from './lib/runtime-mode';
import {track,markMaterial} from './lib/hosted-usage';
import {browserStorageStatus,restoreBrowserBackup} from './lib/browser-library';
import {normalizeXArticleUrl} from "./lib/x-article-url";
import {X_CAPTURE_MAX_BYTES, type XArticleCapture} from "./lib/x-article-capture";
import { confidentlyEnglish } from "./lib/translation-policy";
import { buildTranslationSource, copyWebTranslation, translationModelConfig, isTranslationModelConfig, translationModelsUsed, unionTranslationModels, TRANSLATION_CONTRACT_VERSION, TRANSLATION_QUALITY_VERSION, TRANSLATION_LIMITS, TRANSLATION_BATCH_TARGET, type TranslationSource, type WebTranslationState } from "./lib/web-translation";
import { modelConfig } from "./lib/model-routing";
import { hasRecoveryDifference } from "./lib/recovery-diff";
import { useEffect, useRef, useState } from "react";
import type { Workspace } from "./types";
import { safeWebUrl, type WebImportJob } from "./lib/web-data";
import { migrateHighlightAnchors } from "./lib/anchor-migration";
import { readDocumentFile } from "./lib/reading-document";
import { libraryRequest as api, libraryBinary } from "./lib/library-client";
import type { LibraryEntry, LibraryList, ReadingPosition, SelectedFile, SourceCheck } from "./lib/library-types";

import { DraftStore, readingKey, readingContent, withPreferences, type StoredDraft, type RecoveryRecord, type RecoverySummary, type RecoveryResult } from "./lib/reading-recovery";
export interface TranslationActivity {
  phase: "preparing" | "waiting" | "saving";
  completed: number;
  total: number;
  startedAt: number;
  phaseStartedAt: number;
}
const translationCount = (completed: number, total: number) => `已翻译 ${completed} / ${total} 个文本块`;
const MIGRATION_KEY = "got-it.library.migration.v1";
const PREFS_KEY = "got-it.model-preferences.v1";

function savedLabel(w: Workspace) { if(HOSTED)return "已保存到当前浏览器"; if(w.document.kind==='web'&&w.document.web.extractorVersion==='x-fxtwitter-public-v1'){const missing=w.document.web.media.filter(m=>m.status!=='saved').length;if(missing)return `正文已保存到本机，${missing}张图片未保存`;}return w.document.kind === "web" && w.document.web.media.some(m => m.status !== "saved") ? "已保存，部分内容未导入" : "已保存到本机"; }
const emptyList: LibraryList = { entries: [], activeId: null, warnings: [], nativePicker: true };
const message = (e: unknown) => e instanceof TypeError && /fetch|network|load/i.test(e.message) ? HOSTED?"无法连接体验服务，请检查网络后重试。":"无法连接本机阅读服务，请确认服务正在运行后重试。" : e instanceof Error ? e.message : "本机阅读操作失败，请重试。";
export function capturePosition(): ReadingPosition {
  const el = document.querySelector<HTMLElement>(".reader-scroll");
  if (!el) return { ratio: 0 };
  const top = el.getBoundingClientRect().top;
  const block = [...el.querySelectorAll<HTMLElement>("[data-block-id]")].find(n => n.getBoundingClientRect().bottom > top);
  const pdf = el.querySelector<HTMLElement>(".pdf-reader");
  return { ...(pdf?{pdfPage:Number(block?.closest<HTMLElement>("[data-pdf-page]")?.dataset.pdfPage??1),pdfZoom:0,pdfLeft:0}:{}), ratio: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight), ...(block ? { blockId: block.dataset.blockId, offset: block.getBoundingClientRect().top - top } : {}) };
}
export function restorePosition(p: ReadingPosition) {
  const el = document.querySelector<HTMLElement>(".reader-scroll"); if (!el) return;
  const block = [...el.querySelectorAll<HTMLElement>("[data-block-id]")].find(n => n.dataset.blockId === p.blockId);
  const legacyPdf = !block && p.pdfPage ? el.querySelector<HTMLElement>(`[data-pdf-page="${p.pdfPage}"]`) : null;
  const top = legacyPdf ? el.scrollTop + legacyPdf.getBoundingClientRect().top - el.getBoundingClientRect().top + p.ratio * Math.max(0,legacyPdf.clientHeight-el.clientHeight) : block ? el.scrollTop + block.getBoundingClientRect().top - el.getBoundingClientRect().top - (p.offset || 0) : p.ratio * Math.max(0, el.scrollHeight - el.clientHeight);
  const left = el.querySelector(".pdf-reader") ? 0 : p.pdfLeft ?? el.scrollLeft;
  // Restore both axes together; two smooth property writes cancel the first axis.
  if (typeof el.scrollTo === "function") el.scrollTo({left,top,behavior:"instant"});
  else { el.scrollLeft=left;el.scrollTop=top; }
}
interface Options { workspace: Workspace; install: (w: Workspace,entryId?:string) => void; interrupt: () => Workspace; update?: (w: Workspace) => void; getWorkspace?: () => Workspace }
export function useReadingLibrary(options: Options) {
  const latest = useRef(options); latest.current = options;
  const entryRef = useRef<LibraryEntry | null>(null);
  const [entry, setEntry] = useState<LibraryEntry | null>(null);
  const [list, setList] = useState(emptyList);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const initialized = useRef(false);
  const importSequence = useRef(0);
  const readonlyRef = useRef(false);
  const [historyId, setHistoryId] = useState("");
  const [status, setStatus] = useState(HOSTED?"正在打开浏览器阅读库…":"正在连接本机阅读库…");
  const [error, setError] = useState("");
  const [importError, setImportError] = useState(false);
  const [check, setCheck] = useState<SourceCheck | null>(null);
  const [recovery, setRecovery] = useState<RecoveryRecord | null>(null);
  const recoveryRef = useRef<RecoveryRecord | null>(null);
  const dismissedRecoveries = useRef(new Set<string>());
  const [recoveries, setRecoveries] = useState<RecoverySummary[]>([]);
  const [draftWarning, setDraftWarning] = useState("");
  const [blocked, setBlocked] = useState(false);
  const blockedDraft = useRef<StoredDraft | null>(null);
  const storeRef = useRef<DraftStore | null>(null);
  const store = () => storeRef.current ??= new DraftStore(localStorage);
  const [notice, setNotice] = useState("");
  const [webImportOpen, setWebImportOpen] = useState(false);
  const [webImportSuccess, setWebImportSuccess] = useState(0);
  const [webJob, setWebJob] = useState<WebImportJob | null>(null);
  const [webError, setWebError] = useState("");
  const webOperation = useRef<{ operationId: string; creationKey: string; url: string; autoOpen?: boolean; autoStarted?: boolean; capture?: XArticleCapture } | null>(null);
  const captureSequence = useRef(0);
  const webPoll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desiredFragment = useRef<string | null>(null);
  const translationOperation = useRef<{id:string;entryId:string;cancelled:boolean;readingPdf?:boolean} | null>(null);
  const [translationRunning, setTranslationRunning] = useState(false);
  const [translationProgress, setTranslationProgress] = useState("");
  const [translationRepairCount,setTranslationRepairCount]=useState(0);
  const [translationActivity, setTranslationActivity] = useState<TranslationActivity | null>(null);
  const activityRef = useRef<TranslationActivity | null>(null);
  function reportTranslationActivity(activity: TranslationActivity | null) {
    activityRef.current = activity; setTranslationActivity(activity);
  }
  const [autoTranslate, setAutoTranslate] = useState(() => { try { return localStorage.getItem("got-it.web-translation-auto.v1") === "true"; } catch { return false; } });
  function setAutoTranslation(value:boolean) { setAutoTranslate(value); try { localStorage.setItem("got-it.web-translation-auto.v1",String(value)); } catch { setNotice("自动翻译偏好未能保存，请检查浏览器存储。"); } }
  function updateTranslation(state:WebTranslationState) {
    const base = latest.current.getWorkspace?.() ?? latest.current.workspace;
    // PDF has no whole-document translated side; each page chooses original or Chinese draft.
    const next = {...base,webTranslation:state,readingSide:base.document.kind === "pdf" ? "original" as const : "translated" as const,translationNotice:undefined,updatedAt:new Date().toISOString(),hasUnexportedChanges:true};
    latest.current.workspace=next; (latest.current.update ?? latest.current.install)(next);
    writeDraft(next, capturePosition());
    return next;
  }
  function stopTranslation() {
    setTranslationRepairCount(0);
    const operation=translationOperation.current; if (!operation) return;
    const activity = activityRef.current;
    operation.cancelled=true;translationOperation.current=null;setTranslationRunning(false);
    reportTranslationActivity(null);setTranslationRepairCount(0);
    // Stopped while the PDF text layer was still being read locally: nothing was sent, nothing to mark.
    if(operation.readingPdf){setTranslationProgress("已停止，尚未发送任何正文");return;}
    setTranslationProgress(`${activity ? translationCount(activity.completed, activity.total) + "；" : ""}翻译已中断，可主动续译`);
    const state=latest.current.workspace.webTranslation;
    if(state) updateTranslation({...state,batchEpoch:(state.batchEpoch??0)+1,status:"interrupted",updatedAt:new Date().toISOString()});
    void api(`/entries/${operation.entryId}/translation-batches/${operation.id}/cancel`,{}).catch(()=>{});
  }
  async function translate() {
    const startedAt=Date.now();
    if (translationOperation.current || busyRef.current || readonlyRef.current || blockedDraft.current || !ready) return;
    const e=entryRef.current, doc=latest.current.workspace.document;
    // Web and Markdown share this flow; each kind supplies its own source and version.
    if (!e) return;
    let pdfImagePages=0;
    let translationSource:{source:TranslationSource;sourceVersion:string;pages?:{scanned:boolean}[]}|null=documentTranslationSource(doc);
    if (!translationSource && doc.kind==="pdf") {
      // PDF units come from the saved file's text layer; reading it is local and costs no model call.
      const loading={id:crypto.randomUUID(),entryId:e.id,cancelled:false,readingPdf:true};translationOperation.current=loading;setTranslationRunning(true);
      setTranslationProgress("正在读取 PDF 文字层…");
      try { translationSource=await loadPdfTranslationSource(doc.pdf.resourceId,async()=>new Uint8Array(await (await libraryBinary(`/entries/${e.id}/resources/${doc.pdf.resourceId}`)).arrayBuffer())); }
      catch { if(translationOperation.current===loading)setTranslationProgress("PDF 文字层读取失败，暂不能全文翻译；原页和知识贴不受影响。");return; }
      finally { if(translationOperation.current===loading){translationOperation.current=null;setTranslationRunning(false);} }
      if (loading.cancelled || entryRef.current?.id!==e.id || latest.current.workspace.document.id!==doc.id) return;
      if (!translationSource.source.units.length) { setTranslationProgress("这份 PDF 没有可翻译的文字层，可框选后提问。"); return; }
      if (confidentlyChinese(translationSource.source.units.map(u=>u.text).join("\n"))) { setTranslationProgress("这份 PDF 正文已是中文，无需翻译。"); return; }
      pdfImagePages=translationSource.pages?.filter(p=>p.scanned).length??0;
      setTranslationProgress("");
    }
    if (!translationSource) return;
    const {source,sourceVersion}=translationSource;
    let state=copyWebTranslation(latest.current.workspace.webTranslation,doc.id,sourceVersion,source);
    if(state?.status==="complete")return;
    setTranslationRepairCount(0);
    const requestConfig=translationModelConfig(HOSTED);
    state=state ?? {version:TRANSLATION_CONTRACT_VERSION,id:crypto.randomUUID(),target:"zh",documentId:doc.id,sourceVersion:sourceVersion,status:"partial",modelConfig:requestConfig,units:{},updatedAt:new Date().toISOString()};
    const operation:{id:string;roundId:string;entryId:string;cancelled:boolean}={id:crypto.randomUUID(),roundId:crypto.randomUUID(),entryId:e.id,cancelled:false};translationOperation.current=operation;setTranslationRunning(true);
    reportTranslationActivity({phase:"preparing",completed:Object.keys(state.units).length,total:source.units.length,startedAt,phaseStartedAt:Date.now()});
    setTranslationProgress("");
    const deadline=Date.now()+TRANSLATION_LIMITS.roundMs;
    try {
      const remaining=source.units.filter(unit=>state!.units[unit.id]===undefined);
      while(remaining.length && !operation.cancelled) {
        if(Date.now()>deadline)throw new Error("本轮翻译已到时间上限，已完成部分保留，请主动续译。");
        const batch:typeof remaining=[];let size=0;
        while(remaining.length && batch.length<TRANSLATION_BATCH_TARGET.units && size+remaining[0].text.length<=TRANSLATION_BATCH_TARGET.inputChars) {const unit=remaining.shift()!;batch.push(unit);size+=unit.text.length;}
        if(!batch.length)throw new Error("正文单元超过翻译预算，请检查分块。");
        setTranslationProgress("");
        reportTranslationActivity({phase:"preparing",completed:Object.keys(state.units).length,total:source.units.length,startedAt,phaseStartedAt:Date.now()});
        const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({entryId:e.id,revisionId:e.revisionId,contractVersion:state.version,qualityVersion:TRANSLATION_QUALITY_VERSION,sourceVersion:sourceVersion,translationId:state.id,batchEpoch:state.batchEpoch??0,modelConfig:requestConfig,unitIds:batch.map(unit=>unit.id)})));
        operation.id=`${state.id}-${Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("").slice(0,32)}`;
        if(operation.cancelled || translationOperation.current!==operation)return;
        reportTranslationActivity({phase:"waiting",completed:Object.keys(state.units).length,total:source.units.length,startedAt,phaseStartedAt:Date.now()});
        const result=await api<{repairCount?:number;operationId:string;translationId:string;sourceVersion:string;modelConfig:WebTranslationState['modelConfig'];providerId?:WebTranslationState['providerId'];units:Record<string,string>}>(`/entries/${e.id}/translation-batches`,{qualityVersion:TRANSLATION_QUALITY_VERSION,operationId:operation.id,roundId:operation.roundId,revisionId:e.revisionId,sourceVersion:sourceVersion,translationId:state.id,unitIds:batch.map(u=>u.id),modelConfig:requestConfig});
        if(operation.cancelled || translationOperation.current!==operation || latest.current.workspace.document.id!==doc.id) return;
        if(!isTranslationModelConfig(result.modelConfig,HOSTED)||(HOSTED&&result.providerId!=='deepseek') || result.operationId!==operation.id || result.translationId!==state.id || result.sourceVersion!==sourceVersion || Object.keys(result.units).length!==batch.length || batch.some(u=>typeof result.units[u.id]!=="string"))throw new Error("翻译结果与正文批次不匹配。");
        const candidate={...state,modelConfig:result.modelConfig,...(result.providerId?{providerId:result.providerId}:{}),modelConfigsUsed:unionTranslationModels(translationModelsUsed(state),result.modelConfig),units:{...state.units,...result.units},status:remaining.length?"partial" as const:"complete" as const,updatedAt:new Date().toISOString(),error:undefined};
        const checked=copyWebTranslation(candidate,doc.id,sourceVersion,source);
        if(!checked)throw new Error("翻译内容校验失败，已保存部分保留。");
        state=checked;
        if(Number.isInteger(result.repairCount)&&result.repairCount!>0&&result.repairCount!<=batch.length)setTranslationRepairCount(count=>count+result.repairCount!);
        reportTranslationActivity({phase:"saving",completed:Object.keys(state.units).length,total:source.units.length,startedAt,phaseStartedAt:Date.now()});
        const next=updateTranslation(state);await flush(next);
        if (readonlyRef.current || recoveryRef.current || blockedDraft.current || entryRef.current?.id!==e.id) throw new Error("翻译成果须先核对恢复记录，尚未确认保存。");
      }
      if(!operation.cancelled && !remaining.length && state.status !== "complete") { reportTranslationActivity({phase:"saving",completed:Object.keys(state.units).length,total:source.units.length,startedAt,phaseStartedAt:Date.now()}); state={...state,status:"complete",error:undefined,updatedAt:new Date().toISOString()};await flush(updateTranslation(state)); }
      if(!operation.cancelled)setTranslationProgress(state.status==="complete"?(doc.kind==="web"&&doc.web.coverage==="public-excerpt"?"已保存公开正文译中已保存":pdfImagePages?`有文字的页面已译完并保存；${pdfImagePages} 页为图片，暂不能翻译`:"全文译中已保存"):"部分译文已保存，可主动续译");
    } catch(error) {
      if(operation.cancelled || translationOperation.current!==operation)return;
      if (readonlyRef.current || recoveryRef.current || blockedDraft.current || entryRef.current?.id!==e.id) { setTranslationProgress(`${translationCount(Object.keys(state.units).length,source.units.length)}；翻译成果待核对，尚未确认保存；已收到部分已保留。`);return; }
      // A batch the service reported as failed gets a fresh operation id on resume (the hosted service refuses
      // ids that already failed); a lost response keeps its id so a completed result can be reused without a new charge.
      const rejected=typeof (error as {status?:unknown})?.status==="number";
      updateTranslation({...state,...(rejected?{batchEpoch:(state.batchEpoch??0)+1}:{}),status:"failed",error:message(error),updatedAt:new Date().toISOString()});setTranslationProgress(`${translationCount(Object.keys(state.units).length,source.units.length)}；${message(error)}`);
      if(!savePaused.current)void flush().catch(()=>{});
    } finally { if(translationOperation.current===operation){translationOperation.current=null;setTranslationRunning(false);reportTranslationActivity(null);} }
  }
  const saved = useRef("");
  const savePaused = useRef(false);
  const saving = useRef(false);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desiredPosition = useRef<ReadingPosition>({ ratio: 0 });
  const restorePending = useRef(false);
  const fingerprint = readingKey;
  function remember(e: LibraryEntry) { entryRef.current = e; setEntry(e); }
  function writeDraft(w: Workspace, p: ReadingPosition) {
    const e = entryRef.current; if (!e) return;
    try { return store().write(e, w, p); }
    catch { setError("浏览器应急缓存不可用，请等待本机保存完成后再关闭。"); }
  }
  function clearOwn(w: Workspace, p: ReadingPosition) {
    try { const d = entryRef.current && store().own(entryRef.current.id); if (d && !saving.current && saved.current === fingerprint(w,p)) store().remove(d); }
    catch { /* Keep inaccessible emergency data. */ }
  }
  function preview(r: RecoveryRecord | null) {
    recoveryRef.current=r; setRecovery(r);
  }
  async function refreshRecoveries() { const records = await api<RecoverySummary[]>("/recoveries"); setRecoveries(records); return records; }
  function install(e: LibraryEntry, revision = "") {
    setTranslationRepairCount(0);
    desiredFragment.current = null;
    setTranslationProgress("");
    reportTranslationActivity(null);
    savePaused.current = false;
    preview(null); blockedDraft.current=null; setBlocked(false); setCheck(null);
    remember(e); readonlyRef.current = !!revision; setHistoryId(revision);
    const historic = e.history.find(r => r.id === revision);
    const w = migrateHighlightAnchors(historic?.workspace ?? e.workspace);
    // Future model preferences belong to this machine, never to the imported document.
    const current = latest.current.workspace;
    const next = { ...w, activeProviderId: current.activeProviderId, modelPreferences: current.modelPreferences, modelDefaultsVersion: current.modelDefaultsVersion };
    desiredPosition.current = historic?.position ?? e.position;
    restorePending.current = true;
    latest.current.install(next,e.id); latest.current.workspace = next;
    saved.current = fingerprint(next, desiredPosition.current);
    setStatus(revision ? "正在回看旧版本 · 只读" : savedLabel(next));
  }
  async function refresh() { const result = await api<LibraryList>(); setList(result); return result; }
  async function checkSource() {
    const e = entryRef.current; if (!e) return;
    if (e.workspace.document.kind === "web") { setCheck(null); return; }
    const result = await api<SourceCheck>(`/entries/${e.id}/check`, {});
    if (entryRef.current?.id === e.id) setCheck(result);
  }
  async function flush(explicit?: Workspace) {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const work = async () => {
      const e = entryRef.current;
      if (blockedDraft.current) throw new Error("须先保存阅读记录才能离开，请重试保存。");
      if (!e || readonlyRef.current || recoveryRef.current) return;
      const w = explicit ?? latest.current.workspace;
      const p = restorePending.current ? desiredPosition.current : capturePosition();
      const fp = fingerprint(w, p);
      if (saved.current === fp) { clearOwn(w,p); return; }
      const draft = writeDraft(w, p); setStatus("保存中…"); saving.current=true;
      try {
        const next = await api<LibraryEntry>(`/entries/${e.id}/save`, { expectedVersion: e.version, revisionId: e.revisionId, workspace: w, position: p });
        if(HOSTED)void browserStorageStatus(true);
        remember(next); savePaused.current = false; saved.current = fp; setError("");
        const currentPosition = restorePending.current ? desiredPosition.current : capturePosition();
        const hasNewerChanges = fingerprint(latest.current.workspace, currentPosition) !== fp;
        setStatus(hasNewerChanges ? "保存中…" : savedLabel(w));
        if (hasNewerChanges) {
          writeDraft(latest.current.workspace, currentPosition);
          if (!timer.current) timer.current = setTimeout(() => { timer.current = null; void flush().catch(() => {}); }, 500);
        }
        if (draft) store().remove(draft);
      } catch (error) {
        track('save-failed');
        if ((error as {status?:number}).status === 409) {
          const current = latest.current.interrupt(); latest.current.workspace=current;
          const latestDraft = writeDraft(current, restorePending.current ? desiredPosition.current : capturePosition()) ?? draft;
          if (latestDraft) {
            blockedDraft.current=latestDraft;setBlocked(true);
            try {
              const result=await api<RecoveryResult>(`/entries/${e.id}/recover`,latestDraft.draft);
              store().remove(latestDraft);blockedDraft.current=null;setBlocked(false);
              if(result.kind === "review") { install(await api<LibraryEntry>(`/entries/${e.id}`)); if(result.record.state === "pending" && result.record.disk && hasRecoveryDifference(result.record.draft.workspace,result.record.disk.workspace)) { preview(result.record); readonlyRef.current=true; } setStatus(HOSTED?"已保存到当前浏览器":"已保存到本机"); }
              else install(result.entry);
              await refreshRecoveries();setError("");return;
            } catch (failure) { error=failure; }
          }
        }
        savePaused.current = true; setStatus("阅读进度暂未保存"); setError(message(error)); throw error;
      } finally { saving.current=false; }
    };
    const job = pending.current.catch(() => {}).then(work); pending.current = job; return job;
  }
  async function retryWebMedia(mediaId:string) {
    const origin=entryRef.current,doc=latest.current.workspace.document;
    if(!origin||doc.kind!=="web"||readonlyRef.current||recoveryRef.current||blockedDraft.current||busyRef.current)throw new Error("当前阅读版本不可重试图片。");
    const revision=origin.revisionId,documentId=doc.id;
    await flush();
    const work=async()=>{
      if(entryRef.current?.id!==origin.id||entryRef.current.revisionId!==revision||readonlyRef.current)throw new Error("阅读材料已切换，请在当前材料重试。");
      const result=await api<LibraryEntry>(`/entries/${origin.id}/web-media/${encodeURIComponent(mediaId)}/retry`,{revisionId:revision});
      const current=latest.current.getWorkspace?.()??latest.current.workspace;
      if(entryRef.current?.id!==origin.id||entryRef.current.revisionId!==revision||current.document.id!==documentId||current.document.kind!=="web"||readonlyRef.current)return;
      if(result.workspace.document.kind!=="web")throw new Error("图片恢复结果无效，请重试。");
      const media=result.workspace.document.web.media.find(item=>item.id===mediaId);
      if(!media||media.status!=="saved")throw new Error("图片尚未保存，请重试。");
      const next={...current,document:{...current.document,web:{...current.document.web,media:current.document.web.media.map(item=>item.id===mediaId?media:item)}}};
      remember(result);saved.current=fingerprint(result.workspace,result.position);
      latest.current.workspace=next;(latest.current.update??latest.current.install)(next);
      const position=capturePosition();
      if(fingerprint(next,position)!==saved.current){writeDraft(next,position);setStatus("保存中…");if(!timer.current)timer.current=setTimeout(()=>{timer.current=null;void flush().catch(()=>{});},500);}
      else {clearOwn(next,position);setStatus(savedLabel(next));}
    };
    const job=pending.current.catch(()=>{}).then(work);pending.current=job;return job;
  }
  async function transition(work: () => Promise<void>, importing = false) {
    if (busyRef.current) return;
    importSequence.current++;
    busyRef.current = true; setBusy(true); setError(""); setImportError(false);
    try { await work(); } catch (e) { setImportError(importing && !savePaused.current && !blockedDraft.current); setError(message(e)); } finally { busyRef.current = false; setBusy(false); }
  }
  async function preserve() {
    if (blockedDraft.current) throw new Error("须先保存阅读记录才能离开，请重试保存。");
    if (readonlyRef.current || recoveryRef.current) return;
    stopTranslation();
    const w = latest.current.interrupt(); latest.current.workspace = w;
    await flush(w);
  }
  async function open(id: string) {
    await transition(async () => {
      await api<LibraryEntry>(`/entries/${id}`); // Read before interrupting the current request.
      await preserve();
      const e = await api<LibraryEntry>(`/entries/${id}/activate`, {});
      install(e); for (const r of recoveries) if (r.entryId===id || r.resultEntryId===id) dismissedRecoveries.current.delete(r.id);
      await refresh(); await refreshRecoveries(); await checkSource();
    });
  }
  async function openBookmark(id:string):Promise<boolean> {
    if(busyRef.current)return false;
    let opened=false;
    await transition(async()=>{
      const target=await api<{entry:LibraryEntry;revisionId:string}>(`/bookmarks/${id}/location`);
      await preserve();
      const current=await api<LibraryEntry>(`/entries/${target.entry.id}/activate`,{});
      if(target.revisionId!==current.revisionId&&!current.history.some(revision=>revision.id===target.revisionId))throw new Error('收藏对应的原文版本已不可用，摘录仍保留。');
      install(current,target.revisionId===current.revisionId?'':target.revisionId);
      const installed=latest.current.workspace;if(installed.readingSide==='translated'){const original={...installed,readingSide:'original' as const};latest.current.workspace=original;latest.current.install(original,current.id);}
      await refresh();opened=true;
    });
    return opened;
  }
  const ensuringEntry=useRef<Promise<LibraryEntry>|null>(null);
  const [preparingEntry,setPreparingEntry]=useState(false);
  async function ensureEntry():Promise<LibraryEntry>{
    if(entryRef.current)return entryRef.current;
    if(!HOSTED)throw new Error('请先添加阅读材料。');
    if(ensuringEntry.current)return ensuringEntry.current;
    if(busyRef.current)throw new Error('阅读材料正在切换，请稍后重试。');
    const workspace=latest.current.getWorkspace?.()??latest.current.workspace,documentId=workspace.document.id;
    busyRef.current=true;setPreparingEntry(true);
    const job=(async()=>{const activated=await api<LibraryEntry>('/entries',{workspace,creationKey:`welcome:${documentId}`,activate:true});
      const current=latest.current.getWorkspace?.()??latest.current.workspace;
      if(current.document.id!==documentId)throw new Error('阅读材料已切换，本次操作已取消。');
      remember(activated);saved.current=fingerprint(activated.workspace,activated.position);setStatus(savedLabel(activated.workspace));await refresh();return activated;})();
    ensuringEntry.current=job;try{return await job;}finally{ensuringEntry.current=null;busyRef.current=false;setPreparingEntry(false);}

  }
  async function addWorkspace(w: Workspace, selectionId?: string) {
    await preserve();
    const preferences = latest.current.workspace;
    const e = await api<LibraryEntry>("/entries", { workspace: { ...w, modelPreferences: preferences.modelPreferences, modelDefaultsVersion: preferences.modelDefaultsVersion, activeProviderId: preferences.activeProviderId }, creationKey: crypto.randomUUID(), selectionId });
    install(await api<LibraryEntry>(`/entries/${e.id}/activate`, {})); markMaterial(w.document.id.startsWith("sample-")?"sample":w.document.kind==="pdf"?"pdf":"markdown"); await refresh(); await checkSource();
  }
  async function importFile(file: File) {
    const sample=HOSTED?sampleForFile(file):undefined;
    const annotate=(w:Workspace):Workspace=>sample?{...w,document:{...w.document,id:`sample-${sample.id}-${sample.sha256}`,contentHash:sample.sha256}}:w;
    if (busyRef.current || !ready) return;
    const sequence = ++importSequence.current;
    try { if(HOSTED && file.name.endsWith('.gotit')){await preserve();track('restore');await restoreBrowserBackup(await file.text());track('restore-success');await refresh();await initialize();return;} if(file.name.toLowerCase().endsWith('.pdf')){if(file.size>50*1024*1024)throw new Error('PDF 须不超过 50 MiB。');await transition(async()=>{const selected:SelectedFile=await (await libraryBinary('/pdf?filename='+encodeURIComponent(file.name),new Blob([file],{type:'application/pdf'}))).json();await addWorkspace(annotate(selected.workspace!),selected.selectionId);}, true);return;} const w = await readDocumentFile(file); if (sequence !== importSequence.current) return; await transition(() => addWorkspace(annotate(w)), true); }
    catch (e) { if(HOSTED&&file.name.endsWith('.gotit'))track('restore-failed'); if (sequence === importSequence.current) { setImportError(true); setError(message(e)); } }
  }
  async function choose(relink = false) {
    await transition(async () => {
      const selected = await api<SelectedFile | null>("/choose", {}); if (!selected) return;
      if (!relink) { await addWorkspace(selected.workspace ?? await readDocumentFile({ name: selected.filename, size: new TextEncoder().encode(selected.content).length, text: async () => selected.content }), selected.selectionId); return; }
      await preserve(); const e = entryRef.current; if (!e) return;
      const result = await api<{ entry: LibraryEntry; check: SourceCheck }>(`/entries/${e.id}/relink`, { selectionId: selected.selectionId, expectedVersion: e.version });
      remember(result.entry); setCheck(result.check); await refresh();
    });
  }
  async function acceptUpdate() {
    if (!check?.candidateId || !window.confirm("使用更新后的原文？旧原文和知识贴会保留在之前的阅读版本中，新版的知识贴从空开始。")) return;
    const candidateId = check.candidateId;
    await transition(async () => {
      await preserve(); const e = entryRef.current!;
      install(await api<LibraryEntry>(`/entries/${e.id}/update`, { candidateId, expectedVersion: e.version })); await refresh(); await checkSource();
    });
  }
  async function viewRevision(revision: string) {
    await transition(async () => { await preserve(); install(entryRef.current!, revision); });
  }
  async function showRecovery(id: string) {
    await transition(async()=>{
      const record=await api<RecoveryRecord>(`/recoveries/${id}`);
      await preserve(); await refreshRecoveries(); if (record.state === "pending" && (!record.disk || hasRecoveryDifference(record.draft.workspace,record.disk.workspace))) preview(record);
    });
  }
  function closeRecovery() {
    const closing = recoveryRef.current;
    if (closing) {
      dismissedRecoveries.current.add(closing.id);
      // Closing means continue this reading visit, not immediately inspect the next known copy.
      for (const record of recoveries) if (record.entryId === closing.entryId) dismissedRecoveries.current.add(record.id);
    }
    preview(null); readonlyRef.current=!!historyId;
  }
  async function resolveRecovery(choice: "draft" | "disk") {
    const r = recoveryRef.current; if (!r) return;
    await transition(async()=>{
      try {
        const result=await api<{record:RecoveryRecord;entry:LibraryEntry}>(`/recoveries/${r.id}/resolve`,{choice,expectedVersion:r.current?.version ?? r.disk?.version ?? null});
        await api(`/recoveries/${r.id}/acknowledge`, {});
        install(await api<LibraryEntry>(`/entries/${result.entry.id}/activate`,{}));await refresh();await refreshRecoveries();await checkSource();
      } catch(e) {
        preview(await api<RecoveryRecord>(`/recoveries/${r.id}`));
        throw e;
      }
    });
  }
  async function acknowledgeRecovery() {
    const r = recoveryRef.current; if (!r || r.state !== 'resolved') return;
    await transition(async () => {
      await api(`/recoveries/${r.id}/acknowledge`, {});
      install(await api<LibraryEntry>(`/entries/${r.resultEntryId ?? r.entryId}/activate`, {}));
      await refreshRecoveries(); await refresh(); await checkSource();
    });
  }
  useEffect(() => {
    if (!ready || busy || recovery || historyId || blocked) return;
    const record = recoveries.find(r => r.state === 'pending' && r.hasDifferences !== false && r.entryId === entry?.id && !dismissedRecoveries.current.has(r.id));
    if (!record) return;
    dismissedRecoveries.current.add(record.id);
    void showRecovery(record.id);
  }, [ready,busy,recovery,historyId,blocked,recoveries,entry?.id]);
  function showWebImport() { setWebError(""); setWebImportOpen(true); }
  async function cancelWebImport(close = false) {
    if (busyRef.current) return;
    captureSequence.current++;
    const operation = webOperation.current;
    webOperation.current = null;
    if (webPoll.current) { clearTimeout(webPoll.current); webPoll.current = null; }
    setWebJob(null); setWebError(""); if (close) setWebImportOpen(false);
    if (operation) {
      try { await api(`/web-imports/${operation.operationId}/cancel`, {}); }
      catch { if (!close && !webOperation.current) setWebError("读取已停止，本机临时资源清理未确认；可重新读取，旧结果不会加入。"); }
    }
  }
  function receiveWebJob(result: WebImportJob, operationId: string) {
    if (webOperation.current?.operationId !== operationId) return;
    if (result.operationId !== operationId) throw new Error("读取结果不匹配，请重新读取。");
    setWebJob(result);
    if (result.status === "failed" || result.status === "expired") setWebError(result.error || result.progress);
  }
  async function readWebUrl(input: string, autoOpen = false, capture?: XArticleCapture) {
    if (!ready || busyRef.current) return;
    captureSequence.current++;
    const safe = safeWebUrl(input.trim()), url = safe ? normalizeXArticleUrl(safe) ?? safe : undefined;
    if (!url) { setWebError("请输入无登录凭据的公开 HTTP(S) 文章链接，不支持本机或私网地址。"); return; }
    const previous = webOperation.current;
    if (webPoll.current) clearTimeout(webPoll.current);
    const operation = { operationId: crypto.randomUUID(), creationKey: crypto.randomUUID(), url, autoOpen, autoStarted: false, capture };
    webOperation.current = operation; setWebError(""); setWebImportOpen(true);
    setWebJob({ operationId: operation.operationId, status: "reading", progress: "正在读取文章…" });
    if (previous) void api(`/web-imports/${previous.operationId}/cancel`, {}).catch(() => {});
    try { receiveWebJob(await api<WebImportJob>(capture ? "/x-article-imports" : "/web-imports", { ...(capture ? {capture} : {url}), operationId: operation.operationId }), operation.operationId); }
    catch (e) { if (webOperation.current === operation) { setWebError(message(e)); setWebJob({ operationId: operation.operationId, status: "failed", progress: "读取失败" }); } }
  }
  useEffect(() => {
    if (webJob?.status !== "reading") return;
    const operationId = webJob.operationId;
    webPoll.current = setTimeout(async () => {
      try { receiveWebJob(await api<WebImportJob>(`/web-imports/${operationId}`), operationId); }
      catch (e) { if (webOperation.current?.operationId === operationId) { setWebError(message(e)); setWebJob({ operationId, status: "failed", progress: "读取失败" }); } }
    }, 450);
    return () => { if (webPoll.current) clearTimeout(webPoll.current); };
  }, [webJob]);
  useEffect(() => () => {
    stopTranslation();
    captureSequence.current++;
    const operation = webOperation.current; webOperation.current = null;
    if (webPoll.current) clearTimeout(webPoll.current);
    if (operation) void api(`/web-imports/${operation.operationId}/cancel`, {}).catch(() => {});
  }, []);
  async function confirmWebImport(allowPartial = false) {
    const operation = webOperation.current, job = webJob;
    if (!operation || !job || !["ready", "existing"].includes(job.status) || job.operationId !== operation.operationId) return;
    await transition(async () => {
      setWebError("");
      try {
        let checked: WebImportJob;
        const invalidateCandidate = () => { if (webOperation.current === operation) { webOperation.current = null; setWebJob(null); } };
        try { checked = await api<WebImportJob>(`/web-imports/${operation.operationId}`); }
        catch (error) {
          // This GET has no entry/resource lookup: 404 means the temporary job is gone.
          if ((error as { status?: number })?.status === 404) invalidateCandidate();
          throw error;
        }
        if (["expired", "cancelled"].includes(checked.status)) { invalidateCandidate(); throw new Error(operation.capture ? "捕获作业已失效，请重新选择 X 文章文件。" : "读取作业已失效，请点击“阅读文章”重新读取。"); }
        if (webOperation.current !== operation || checked.operationId !== operation.operationId || !["ready", "existing"].includes(checked.status)) throw new Error("预览已失效，请重新读取。");
        if (!checked.entryId && (!checked.preview || checked.preview.candidateId !== job.preview?.candidateId)) throw new Error("预览已失效，请重新读取。");
        if (checked.entryId) await api<LibraryEntry>(`/entries/${checked.entryId}`);
        await preserve();
        if (recoveryRef.current || blockedDraft.current || savePaused.current) throw new Error("当前阅读成果尚未完成保存或核对，文章尚未打开。请先处理当前阅读记录后重试。");
        const e = checked.entryId ? await api<LibraryEntry & {webImportCreated?:boolean}>(`/entries/${checked.entryId}`) : await api<LibraryEntry & {webImportCreated?:boolean}>(`/web-imports/${operation.operationId}/confirm`, { candidateId: checked.preview!.candidateId, creationKey: operation.creationKey, allowPartial });
        install(await api<LibraryEntry>(`/entries/${e.id}/activate`, {}));
        setWebImportSuccess(sequence => sequence + 1);
        try { desiredFragment.current = decodeURIComponent(new URL(operation.url).hash.slice(1)) || null; } catch { desiredFragment.current = null; }
        webOperation.current = null; setWebJob(null); setWebImportOpen(false);
        await refresh(); await checkSource();
        if (e.webImportCreated === true && autoTranslate) { const text=e.workspace.document.kind === "web" ? buildTranslationSource(e.workspace.document.markdown,e.workspace.document.web).units.map(u=>u.text).join(" ") : ""; if(confidentlyEnglish(text)) setTimeout(()=>{ if(entryRef.current?.id===e.id)void translate(); },0); }
      } catch (e) { setWebError(message(e)); throw e; }
    });
  }
  async function readXArticleFile(file: Pick<File, "size" | "text">) {
    if (!ready || busyRef.current) return;
    const sequence = ++captureSequence.current;
    try {
      if (file.size > X_CAPTURE_MAX_BYTES) throw new Error("X 文章文件超过 2 MiB，请重新捕获较小的文章。");
      const raw = await file.text();
      if (sequence !== captureSequence.current || busyRef.current) return;
      if (new TextEncoder().encode(raw).length > X_CAPTURE_MAX_BYTES) throw new Error("X 文章文件超过 2 MiB。");
      const capture = JSON.parse(raw) as XArticleCapture;
      if (!capture || capture.format !== "got-it-x-article" || capture.version !== 1 || typeof capture.url !== "string") throw new Error("请选择 got-it 书签生成的 X 文章文件。");
      const operation = webOperation.current;
      const doc = webJob?.preview?.workspace.document;
      if (operation?.capture && capture.url === operation.url && webJob && ["ready", "existing"].includes(webJob.status) && !(doc?.kind === "web" && doc.web.media.some(m=>m.status!=="saved"))) { await confirmWebImport(); return; }
      await readWebUrl(capture.url, true, capture);
    } catch (error) { if(sequence !== captureSequence.current)return; setWebError(error instanceof SyntaxError ? "文章文件不是有效 JSON，请重新捕获。" : message(error)); }
  }
  async function readWebArticle(input: string) {
    captureSequence.current++;
    const operation = webOperation.current;
    const doc = webJob?.preview?.workspace.document;
    const missing = doc?.kind === "web" && doc.web.extractorVersion !== "x-fxtwitter-public-v1" && doc.web.media.some(media => media.status !== "saved");
    // Saving retries keep the same candidate and idempotency key; extraction failures start afresh.
    if (operation && (normalizeXArticleUrl(input.trim()) ?? safeWebUrl(input.trim())) === operation.url && !missing && webJob && ["ready", "existing"].includes(webJob.status)) {
      await confirmWebImport();
      return;
    }
    await readWebUrl(input, true);
  }
  useEffect(() => {
    const operation = webOperation.current;
    if (!operation?.autoOpen || operation.autoStarted || busy || !webJob || !["ready", "existing"].includes(webJob.status) || webJob.operationId !== operation.operationId) return;
    operation.autoStarted = true;
    const doc = webJob.preview?.workspace.document;
    if (doc?.kind === "web" && doc.web.extractorVersion !== "x-fxtwitter-public-v1" && doc.web.media.some(media => media.status !== "saved")) {
      setWebError(operation.capture ? "X 文章图片未能完整保存，尚未加入。请重新选择 X 文章文件重试，或在原网站阅读。" : "文章图片或图表未能完整保存，尚未加入。请点击“阅读文章”重试，或在原网站阅读。");
      return;
    }
    void confirmWebImport();
  }, [webJob, busy]);
  async function initialize() {
    if (busyRef.current) return;
    busyRef.current=true;setBusy(true);
    setError("");
    try {
      let result = await refresh();
      const old = latest.current.workspace;
      if (!ready && !HOSTED && !old.document.isDemo && !localStorage.getItem(MIGRATION_KEY)) {
        // Deterministic idempotency key survives a lost response; this key is not a path or credential.
        let key = localStorage.getItem("got-it.library.migration-key.v1");
        if (!key) { key = `legacy:${crypto.randomUUID()}`; localStorage.setItem("got-it.library.migration-key.v1", key); }
        const e = await api<LibraryEntry>("/entries", { workspace: old, creationKey: key });
        localStorage.setItem(MIGRATION_KEY, e.id); result = await refresh();
        if (!result.activeId) result.activeId = e.id;
      }
      const drafts = store().read();
      setDraftWarning(drafts.invalid ? "有一份应急记录格式损坏，无法自动恢复；原数据已保留，请勿清除浏览器数据。" : "");
      const restored = new Map<string,LibraryEntry>();
      let recovered=false;
      for (const item of drafts.drafts) {
        try {
          const outcome=await api<RecoveryResult>(`/entries/${item.draft.entryId}/recover`,item.draft);
          store().remove(item);
          if (outcome.kind !== "review") { restored.set(outcome.entry.id,outcome.entry); recovered ||= outcome.kind === "restored"; }
        } catch(e) {
          // Failed draft persistence must not prevent authorized reads of intact disk media.
          // Only reuse the disk revision when its original content/resources match the draft.
          try {
            const disk = await api<LibraryEntry>(`/entries/${item.draft.entryId}`);
            if (readingContent(disk.workspace) === readingContent(item.draft.workspace)) remember(disk);
          } catch { /* Keep the protected draft even when the disk record is unavailable. */ }
          blockedDraft.current=item;setBlocked(true);readonlyRef.current=true;
          const next=withPreferences(item.draft.workspace,latest.current.workspace);
          latest.current.install(next);latest.current.workspace=next;
          desiredPosition.current=item.draft.position;restorePending.current=true;
          setStatus("阅读进度暂未保存");setError(message(e));setReady(true);return;
        }
      }
      const records=await refreshRecoveries();
      const id = result.activeId ?? result.entries[0]?.id;
      if (id) { install(restored.get(id) ?? await api<LibraryEntry>(`/entries/${id}`)); await checkSource(); }
      else setStatus(HOSTED?"请打开样例或添加本地文件":"示例文档");
      if (records.some(r=>r.state === "pending" && r.hasDifferences !== false)) setStatus("有阅读记录待核对 · 已安全保留");
      if (recovered) setNotice("已恢复上次阅读进度");
      setReady(true);
    } catch (e) { setStatus("本机阅读库未连接"); setError(message(e)); }
    finally {busyRef.current=false;setBusy(false);}
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true; void initialize();
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ modelPreferences: options.workspace.modelPreferences, activeProviderId: options.workspace.activeProviderId, modelDefaultsVersion: options.workspace.modelDefaultsVersion })); } catch { /* no credentials */ }
    if (!ready || !entryRef.current || readonlyRef.current || recoveryRef.current || blockedDraft.current || busyRef.current) return;
    const p = restorePending.current ? desiredPosition.current : capturePosition();
    if (!saving.current && fingerprint(options.workspace, p) === saved.current) { clearOwn(options.workspace,p); return; }
    writeDraft(options.workspace, p);
    if (savePaused.current) return;
    setStatus("保存中…");
    // Do not reset this timer for every streamed token: persist during continuous streaming.
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; void flush().catch(() => {}); }, 500);
  }, [options.workspace, ready]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (entryRef.current && !readonlyRef.current && !recoveryRef.current && !blockedDraft.current && (saving.current || fingerprint(latest.current.workspace, capturePosition()) !== saved.current)) { writeDraft(latest.current.workspace, capturePosition()); event.preventDefault(); }
    };
    window.addEventListener("beforeunload", handler);
    return () => { window.removeEventListener("beforeunload", handler); if (timer.current) clearTimeout(timer.current); };
  }, []);
  function rendered() {
    if (restorePending.current) { restorePosition(desiredPosition.current); restorePending.current = false; }
    const fragment = desiredFragment.current; desiredFragment.current = null;
    const doc = latest.current.workspace.document;
    if (fragment && doc.kind === "web") {
      const match = doc.web.fragments.find(f => f.fragment === fragment);
      const target = match && document.querySelectorAll<HTMLElement>(".markdown-article h1,.markdown-article h2,.markdown-article h3,.markdown-article h4,.markdown-article h5,.markdown-article h6")[match.headingIndex];
      if (target) target.scrollIntoView({ block: "start" });
      else setNotice("链接中的章节未匹配，已打开保存正文。");
    }
  }
  function scrolled() {
    if (restorePending.current || !ready || busyRef.current || readonlyRef.current || recoveryRef.current || blockedDraft.current || !entryRef.current) return;
    if (!saving.current && fingerprint(latest.current.workspace,capturePosition()) === saved.current) { clearOwn(latest.current.workspace,capturePosition()); return; }
    writeDraft(latest.current.workspace, capturePosition());
    if (savePaused.current) return;
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; void flush().catch(() => {}); }, 500);
  }
  useEffect(()=> { if (!notice) return; const id=setTimeout(()=>setNotice(""),4500); return ()=>clearTimeout(id); },[notice]);
  return { ensureEntry, retryWebMedia, translate, stopTranslation, translationRunning, translationProgress, translationActivity, translationRepairCount, autoTranslate, setAutoTranslation, saveNow:flush, webImportOpen, webImportSuccess, webJob, webError, showWebImport, readWebUrl, readWebArticle, readXArticleFile, confirmWebImport, cancelWebImport, initialPosition: desiredPosition.current, entry, list, ready, busy:busy||preparingEntry, error, importError, clearError: () => { setError(""); setImportError(false); }, status, check, recovery, recoveries, blocked, draftWarning, notice, historyId,
    readOnly: !!historyId || !!recovery || blocked || busy,
    openBookmark, prepareBookmarks:preserve, open, choose, importFile, checkSource: () => transition(checkSource), acceptUpdate, viewRevision, resolveRecovery, acknowledgeRecovery, showRecovery, closeRecovery,
    retry: () => ready && !blockedDraft.current ? transition(() => flush()) : initialize(),
    rendered, scrolled };
}
