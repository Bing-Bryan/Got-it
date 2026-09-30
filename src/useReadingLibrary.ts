import { useEffect, useRef, useState } from "react";
import type { Workspace } from "./types";
import { migrateHighlightAnchors } from "./lib/anchor-migration";
import { readDocumentFile } from "./lib/reading-document";
import { libraryRequest as api, libraryBinary } from "./lib/library-client";
import type { LibraryEntry, LibraryList, ReadingPosition, SelectedFile, SourceCheck } from "./lib/library-types";

import { DraftStore, readingKey, withPreferences, type StoredDraft, type RecoveryRecord, type RecoverySummary, type RecoveryResult } from "./lib/reading-recovery";
const MIGRATION_KEY = "got-it.library.migration.v1";
const PREFS_KEY = "got-it.model-preferences.v1";

const emptyList: LibraryList = { entries: [], activeId: null, warnings: [], nativePicker: true };
const message = (e: unknown) => e instanceof TypeError && /fetch|network|load/i.test(e.message) ? "无法连接本机阅读服务，请确认服务正在运行后重试。" : e instanceof Error ? e.message : "本机阅读操作失败，请重试。";
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
interface Options { workspace: Workspace; install: (w: Workspace) => void; interrupt: () => Workspace }
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
  const [status, setStatus] = useState("正在连接本机阅读库…");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<SourceCheck | null>(null);
  const [recovery, setRecovery] = useState<RecoveryRecord | null>(null);
  const recoveryRef = useRef<RecoveryRecord | null>(null);
  const [recoveries, setRecoveries] = useState<RecoverySummary[]>([]);
  const [draftWarning, setDraftWarning] = useState("");
  const [blocked, setBlocked] = useState(false);
  const blockedDraft = useRef<StoredDraft | null>(null);
  const storeRef = useRef<DraftStore | null>(null);
  const store = () => storeRef.current ??= new DraftStore(localStorage);
  const [notice, setNotice] = useState("");
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
    latest.current.install(next); latest.current.workspace = next;
    saved.current = fingerprint(next, desiredPosition.current);
    setStatus(revision ? "正在回看旧版本 · 只读" : "已保存到本机");
  }
  async function refresh() { const result = await api<LibraryList>(); setList(result); return result; }
  async function checkSource() {
    const e = entryRef.current; if (!e) return;
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
        remember(next); savePaused.current = false; saved.current = fp; setError("");
        const currentPosition = restorePending.current ? desiredPosition.current : capturePosition();
        const hasNewerChanges = fingerprint(latest.current.workspace, currentPosition) !== fp;
        setStatus(hasNewerChanges ? "保存中…" : "已保存到本机");
        if (hasNewerChanges) {
          writeDraft(latest.current.workspace, currentPosition);
          if (!timer.current) timer.current = setTimeout(() => { timer.current = null; void flush().catch(() => {}); }, 500);
        }
        if (draft) store().remove(draft);
      } catch (error) {
        if ((error as {status?:number}).status === 409) {
          const current = latest.current.interrupt(); latest.current.workspace=current;
          const latestDraft = writeDraft(current, restorePending.current ? desiredPosition.current : capturePosition()) ?? draft;
          if (latestDraft) {
            blockedDraft.current=latestDraft;setBlocked(true);
            try {
              const result=await api<RecoveryResult>(`/entries/${e.id}/recover`,latestDraft.draft);
              store().remove(latestDraft);blockedDraft.current=null;setBlocked(false);
              if(result.kind === "review") { install(await api<LibraryEntry>(`/entries/${e.id}`)); preview(result.record); readonlyRef.current=true; setStatus("两份阅读记录需要核对"); }
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
  async function transition(work: () => Promise<void>) {
    if (busyRef.current) return;
    importSequence.current++;
    busyRef.current = true; setBusy(true); setError("");
    try { await work(); } catch (e) { setError(message(e)); } finally { busyRef.current = false; setBusy(false); }
  }
  async function preserve() {
    if (blockedDraft.current) throw new Error("须先保存阅读记录才能离开，请重试保存。");
    if (readonlyRef.current || recoveryRef.current) return;
    const w = latest.current.interrupt(); latest.current.workspace = w;
    await flush(w);
  }
  async function open(id: string) {
    await transition(async () => {
      await api<LibraryEntry>(`/entries/${id}`); // Read before interrupting the current request.
      await preserve();
      const e = await api<LibraryEntry>(`/entries/${id}/activate`, {});
      install(e); await refresh(); await checkSource();
    });
  }
  async function addWorkspace(w: Workspace, selectionId?: string) {
    await preserve();
    const preferences = latest.current.workspace;
    const e = await api<LibraryEntry>("/entries", { workspace: { ...w, modelPreferences: preferences.modelPreferences, modelDefaultsVersion: preferences.modelDefaultsVersion, activeProviderId: preferences.activeProviderId }, creationKey: crypto.randomUUID(), selectionId });
    install(await api<LibraryEntry>(`/entries/${e.id}/activate`, {})); await refresh(); await checkSource();
  }
  async function importFile(file: File) {
    if (busyRef.current || !ready) return;
    const sequence = ++importSequence.current;
    try { if(file.name.toLowerCase().endsWith('.pdf')){if(file.size>50*1024*1024)throw new Error('PDF 须不超过 50 MiB。');await transition(async()=>{const selected:SelectedFile=await (await libraryBinary('/pdf?filename='+encodeURIComponent(file.name),new Blob([file],{type:'application/pdf'}))).json();await addWorkspace(selected.workspace!,selected.selectionId);});return;} const w = await readDocumentFile(file); if (sequence !== importSequence.current) return; await transition(() => addWorkspace(w)); }
    catch (e) { if (sequence === importSequence.current) setError(message(e)); }
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
      await preserve(); preview(record); // Comparison lives in a dialog; the article remains unchanged.
    });
  }
  function closeRecovery() { preview(null); readonlyRef.current=!!historyId; }
  async function resolveRecovery(choice: "draft" | "disk") {
    const r = recoveryRef.current; if (!r) return;
    await transition(async()=>{
      try {
        const result=await api<{record:RecoveryRecord;entry:LibraryEntry}>(`/recoveries/${r.id}/resolve`,{choice,expectedVersion:r.disk?.version ?? null});
        install(await api<LibraryEntry>(`/entries/${result.entry.id}/activate`,{}));await refresh();await refreshRecoveries();await checkSource();
      } catch(e) {
        if ((e as {status?:number}).status === 409) preview(await api<RecoveryRecord>(`/recoveries/${r.id}`));
        throw e;
      }
    });
  }
  async function initialize() {
    if (busyRef.current) return;
    busyRef.current=true;setBusy(true);
    setError("");
    try {
      let result = await refresh();
      const old = latest.current.workspace;
      if (!old.document.isDemo && !localStorage.getItem(MIGRATION_KEY)) {
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
      else setStatus("示例文档");
      if (records.some(r=>r.state === "pending")) setStatus("有阅读记录待核对 · 已安全保留");
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
  }
  function scrolled() {
    if (restorePending.current || !ready || busyRef.current || readonlyRef.current || recoveryRef.current || blockedDraft.current || !entryRef.current) return;
    if (!saving.current && fingerprint(latest.current.workspace,capturePosition()) === saved.current) { clearOwn(latest.current.workspace,capturePosition()); return; }
    writeDraft(latest.current.workspace, capturePosition());
    if (savePaused.current) return;
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; void flush().catch(() => {}); }, 500);
  }
  useEffect(()=> { if (!notice) return; const id=setTimeout(()=>setNotice(""),4500); return ()=>clearTimeout(id); },[notice]);
  return { initialPosition: desiredPosition.current, entry, list, ready, busy, error, status, check, recovery, recoveries, blocked, draftWarning, notice, historyId,
    readOnly: !!historyId || !!recovery || blocked || busy,
    open, choose, importFile, checkSource: () => transition(checkSource), acceptUpdate, viewRevision, resolveRecovery, showRecovery, closeRecovery,
    retry: () => ready && !blockedDraft.current ? transition(() => flush()) : initialize(),
    rendered, scrolled };
}
