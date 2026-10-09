import { hasRecoveryDifference } from "../src/lib/recovery-diff";
import { PdfResources } from "./pdf-resources";
import { MAX_PDF_BYTES } from "../src/lib/pdf-data";
import { createInitialWorkspace } from "../src/sample";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname, join } from "node:path";
import { homedir } from "node:os";
import type { Workspace } from "../src/types";
import type { LibraryEntry, LibraryList, LibrarySource, ReadingPosition, SelectedFile, SourceCheck } from "../src/lib/library-types";
import { parseReadingDocument, readDocumentFile, MAX_READING_FILE_BYTES } from "../src/lib/reading-document-core";
import { LibraryError, pickLocalFile, type FilePicker } from "./file-picker";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const uid = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9-]{36}$/.test(s);
const now = () => new Date().toISOString();
const fail = (message: string, status = 400, code = "library_error"): never => { throw new LibraryError(message, status, code); };
const safeWorkspace = (value: unknown): Workspace => {
  // Portable codec validates the complete graph and projects every persisted field.
  try { return parseReadingDocument(JSON.stringify(value), true, true); }
  catch { return fail("阅读记录格式或关联无效，未覆盖已保存内容。"); }
};
function position(value: unknown): ReadingPosition {
  const v = value as Partial<ReadingPosition> | null;
  return { ...(Number.isInteger(v?.pdfPage) && v!.pdfPage!>=1 && v!.pdfPage!<=200 ? {pdfPage:v!.pdfPage} : {}), ...(Number.isFinite(v?.pdfZoom) && v!.pdfZoom!>=0 && v!.pdfZoom!<=4 ? {pdfZoom:v!.pdfZoom} : {}), ...(Number.isFinite(v?.pdfLeft) ? {pdfLeft:Math.max(0,Math.min(100000,v!.pdfLeft!))} : {}), ratio: Number.isFinite(v?.ratio) ? Math.max(0, Math.min(1, v!.ratio!)) : 0,
    ...(typeof v?.blockId === "string" && v.blockId.length < 200 ? { blockId: v.blockId } : {}),
    ...(Number.isFinite(v?.offset) ? { offset: Math.max(-100000, Math.min(100000, v!.offset!)) } : {}) };
}
export function defaultLibraryDir() {
  return process.env.GOT_IT_DATA_DIR || (process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Got-it") : process.platform === "win32" ? join(process.env.LOCALAPPDATA || homedir(), "Got-it") : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "got-it"));
}
import { readingContent, viewKey, sameOriginal, withPreferences, type ReadingDraft, type RecoveryRecord, type RecoveryResult, type RecoverySnapshot, type RecoverySummary } from "../src/lib/reading-recovery";

interface Candidate { workspace?: Workspace; source: LibrarySource | null; filename: string; content: string; expires: number; entryId?: string }
export class ReadingLibrary {
  private queue: Promise<unknown> = Promise.resolve();
  private selections = new Map<string, Candidate>();
  private choosing = false;
  readonly resources: PdfResources;
  constructor(public readonly dir = defaultLibraryDir(), private picker: FilePicker = pickLocalFile, private clock = Date.now) { this.resources = new PdfResources(join(dir, "resources")); }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work); this.queue = next.catch(() => {}); return next;
  }
  private entryDir(id: string) { if (!uid(id)) fail("阅读条目不存在。", 404); return join(this.dir, "entries", id); }
  private async atomic(path: string, data: string) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, "wx", 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      await rename(temp, path);
    } finally { await rm(temp, { force: true }).catch(() => {}); }
  }
  private async syncDirectory(dir: string) {
    // Windows cannot fsync directory handles (EPERM). atomic() still flushes
    // each file before rename; POSIX additionally flushes directory metadata.
    if (process.platform === "win32") return;
    const directory = await open(dir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
  private async commit(entry: LibraryEntry) {
    entry.contentDigest = hash(readingContent(entry.workspace));
    const dir = this.entryDir(entry.id); await mkdir(dir, { recursive: true, mode: 0o700 });
    let previous = "";
    try { previous = await readFile(join(dir, "CURRENT"), "utf8"); } catch { /* first commit */ }
    const name = `${entry.version}-${randomUUID()}.json`;
    await this.atomic(join(dir, name), JSON.stringify(entry));
    await this.atomic(join(dir, "CURRENT"), name);
    await this.syncDirectory(dir);
    // Keep the current and previous committed payload for interrupted-write recovery.
    for (const file of await readdir(dir)) if (file !== name && file !== previous && file !== "CURRENT" && (/\.json$/.test(file) || file.endsWith(".tmp"))) await rm(join(dir, file), { force: true }).catch(() => {});
    return entry;
  }
  async get(id: string): Promise<LibraryEntry> {
    try {
      const dir = this.entryDir(id), pointer = await readFile(join(dir, "CURRENT"), "utf8");
      if (!/^\d+-[a-f0-9-]{36}\.json$/.test(pointer)) throw new Error();
      const e = JSON.parse(await readFile(join(dir, pointer), "utf8")) as LibraryEntry;
      if (e.id !== id || !Number.isSafeInteger(e.version) || !uid(e.revisionId) || !Array.isArray(e.history)) throw new Error();
      e.workspace = safeWorkspace(e.workspace); e.position = position(e.position);
      e.history = e.history.map(r => ({ ...r, workspace: safeWorkspace(r.workspace), position: position(r.position) }));
      e.contentDigest = hash(readingContent(e.workspace)); return e;
    } catch (error) { if (error instanceof LibraryError && error.status === 404) throw error; return fail("阅读条目无法读取，其他材料仍可使用。", 404, "entry_unreadable"); }
  }
  async list(): Promise<LibraryList> {
    const entries: LibraryEntry[] = [], warnings: string[] = [];
    let ids: string[] = [];
    try { ids = await readdir(join(this.dir, "entries")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") fail("无法读取本机阅读列表，请检查保存目录权限。", 503); }
    for (const id of ids.filter(uid)) { try { entries.push(await this.get(id)); } catch { warnings.push("有一份阅读记录无法读取，其他材料不受影响。"); } }
    let activeId: string | null = null;
    try { const value = JSON.parse(await readFile(join(this.dir, "active.json"), "utf8")); if (entries.some(e => e.id === value.id)) activeId = value.id; } catch { /* optional last view */ }
    return { entries: entries.sort((a,b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)).map(e => ({ id: e.id, version: e.version, filename: e.workspace.document.filename, path: e.source?.path ?? null, historyCount: e.history.length, lastOpenedAt: e.lastOpenedAt })), activeId, warnings, nativePicker: process.platform === "darwin" };
  }
  async activate(id: string) {
    return this.serialize(async () => {
      const e = await this.get(id); e.lastOpenedAt = now();
      // Metadata also uses optimistic versioning so another tab cannot silently replace it.
      e.version++; await this.commit(e); await this.atomic(join(this.dir, "active.json"), JSON.stringify({ id })); return e;
    });
  }
  private async readSource(path: string, expectedReal?: string): Promise<Candidate> {
    const realPath = await realpath(path);
    if (expectedReal && realPath !== expectedReal) fail("原路径已指向其他文件，请重新定位。", 409, "source_reselect");
    const file = await open(realPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    const pdf=extname(path).toLowerCase()===".pdf", limit=pdf?MAX_PDF_BYTES:MAX_READING_FILE_BYTES;
    try {
      const stat=await file.stat();
      if(!stat.isFile()||stat.size>limit)fail(pdf?"PDF 须不超过 50 MiB。":"阅读文件须不超过 20 MiB。");
      if(![".pdf",".md",".focus",".json"].includes(extname(path).toLowerCase()))fail("请选择 PDF、Markdown 或阅读文档。");
      const buffer=Buffer.alloc(limit+1);let length=0;
      while(length<buffer.length){const {bytesRead}=await file.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
      if(length>limit)fail("文件超过格式容量限制。");bytes=buffer.subarray(0,length);
    } finally {await file.close();}
    const source={path,realPath,hash:createHash("sha256").update(bytes).digest("hex")};
    if(pdf)return {source,filename:basename(path),content:"",workspace:await this.pdfWorkspace(basename(path),bytes),expires:this.clock()+300_000};
    const content=new TextDecoder("utf-8",{fatal:true}).decode(bytes);if(!content.trim())fail("文件内容为空。");
    return {source:{...source,hash:hash(content)},filename:basename(path),content,expires:this.clock()+300_000};
  }
  private async pdfWorkspace(filename:string,bytes:Buffer):Promise<Workspace>{
    const pdf=await this.resources.pdf(bytes),importedAt=now();
    return {...createInitialWorkspace(),document:{kind:"pdf",id:randomUUID(),filename,importedAt,contentHash:pdf.resourceId,isDemo:false,pdf},updatedAt:importedAt,hasUnexportedChanges:false};
  }
  async uploadPdf(filename:string,bytes:Buffer):Promise<SelectedFile>{
    const name=basename(filename).replace(/[\x00-\x1f]/g,"").slice(0,240);if(!name.toLowerCase().endsWith(".pdf"))fail("请选择 PDF 文件。");
    const workspace=await this.pdfWorkspace(name,bytes),c:Candidate={source:null,filename:name,content:"",workspace,expires:this.clock()+300_000};
    return {selectionId:this.ticket(c),filename:name,content:"",workspace};
  }

  private ticket(candidate: Candidate) {
    for (const [id, c] of this.selections) if (c.expires < this.clock()) this.selections.delete(id);
    if (this.selections.size >= 20) fail("待确认文件过多，请稍后重试。");
    const id = randomUUID(); this.selections.set(id, candidate); return id;
  }
  private consume(id: string, entryId?: string) {
    const c = this.selections.get(id); this.selections.delete(id);
    if (!c || c.expires < this.clock() || c.entryId !== entryId) return fail("文件选择已过期，请重新选择。", 409);
    return c;
  }
  async choose(): Promise<SelectedFile | null> {
    if (this.choosing) fail("已有文件选择窗口，请先完成或取消。", 409);
    this.choosing = true;
    try {
      const path = await this.picker(); if (!path) return null;
      const c = await this.readSource(path);
      // Validate before issuing the one-time ticket; browser runs DOM anchor migration later.
      if (!c.workspace) await readDocumentFile({ name: c.filename, size: Buffer.byteLength(c.content), text: async () => c.content });
      return { selectionId: this.ticket(c), filename: c.filename, content: c.content, ...(c.workspace?{workspace:c.workspace}:{}) };
    } finally { this.choosing = false; }
  }
  async add(value: unknown, creationKey: string, selectionId?: string) {
    if (typeof creationKey !== "string" || !/^[\w:-]{1,160}$/.test(creationKey)) fail("无效的添加请求。");
    const workspace = safeWorkspace(value);
    if (workspace.document.isDemo) fail("示例无需加入阅读列表。");
    return this.serialize(async () => {
      const list = await this.list();
      for (const summary of list.entries) { const existing = await this.get(summary.id); if (existing.creationKey === creationKey) return existing; }
      let source: LibrarySource | null = null;
      let pdfApproved=false;
      if (selectionId) {
        const candidate = this.consume(selectionId);
        if(candidate.workspace){
          if(workspace.document.kind!=="pdf"||workspace.document.id!==candidate.workspace.document.id||workspace.document.contentHash!==candidate.workspace.document.contentHash||workspace.document.filename!==candidate.workspace.document.filename||workspace.inquiries.length)fail("PDF 导入票据不匹配。");
          pdfApproved=true;source=candidate.source;
          if(source)for(const summary of list.entries){const e=await this.get(summary.id);if(e.source?.realPath===source.realPath)return e;}
        }else if (candidate.filename.toLowerCase().endsWith(".md")) {
          if (candidate.content !== workspace.document.markdown) fail("选择的原文与阅读快照不一致。");
          source = candidate.source;
          for (const summary of list.entries) { const e = await this.get(summary.id); if (e.source?.realPath === source?.realPath) return e; }
        }
      }
      if(workspace.document.kind==="pdf"&&!pdfApproved)fail("PDF 需要先上传原始文件。");
      const entry: LibraryEntry = { id: randomUUID(), version: 1, revisionId: randomUUID(), source, workspace, position: { ratio: 0 }, history: [], updatedAt: now(), lastOpenedAt: now(), creationKey };
      if(workspace.document.kind==="pdf"){await this.resources.grant(entry.id,workspace.document.pdf.resourceId);await this.resources.validate(entry.id,workspace);}
      return this.commit(entry);
    });
  }
  async save(id: string, expectedVersion: number, revisionId: string, value: unknown, view: unknown) {
    const workspace = safeWorkspace(value);
    return this.serialize(async () => {
      const e = await this.get(id); this.version(e, expectedVersion);
      if (e.revisionId !== revisionId || e.workspace.document.id !== workspace.document.id || e.workspace.document.kind !== workspace.document.kind || e.workspace.document.contentHash !== workspace.document.contentHash || e.workspace.document.markdown !== workspace.document.markdown) fail("原文版本已变化，请重新打开。", 409);
      await this.resources.validate(id,workspace);
      e.workspace = workspace; e.position = position(view); e.version++; e.updatedAt = now(); return this.commit(e);
    });
  }
  private version(e: LibraryEntry, v: number) { if (e.version !== v) fail("另一页面已更新此材料，正在保留并核对阅读记录。", 409, "version_conflict"); }
  private recoveryPath(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) return fail("恢复记录不存在。", 404);
    return join(this.dir, "recoveries", `${id}.json`);
  }
  private async saveRecovery(record: RecoveryRecord) {
    const dir = join(this.dir, "recoveries"); await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.atomic(this.recoveryPath(record.id), JSON.stringify(record));
    await this.syncDirectory(dir);
  }
  async getRecovery(id: string): Promise<RecoveryRecord> {
    const path = this.recoveryPath(id);
    try {
      const r = JSON.parse(await readFile(path, "utf8")) as RecoveryRecord;
      if (r.id !== id || !uid(r.entryId) || !["pending", "resolved"].includes(r.state)) throw new Error();
      r.draft.workspace = safeWorkspace(r.draft.workspace);
      for (const s of [...r.previous, ...(r.disk ? [r.disk] : [])]) s.workspace = safeWorkspace(s.workspace);
      return r;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return fail("恢复记录不存在。", 404, "recovery_missing");
      return fail("恢复记录无法读取，原始数据仍保留。", 503);
    }
  }
  async listRecoveries(): Promise<RecoverySummary[]> {
    let names: string[];
    try { names = await readdir(join(this.dir, "recoveries")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
    const result: RecoverySummary[] = [];
    for (const name of names.filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
      const r = await this.getRecovery(name.slice(0,-5));
      result.push({id:r.id,entryId:r.entryId,createdAt:r.createdAt,state:r.state,resultEntryId:r.resultEntryId,acknowledgedAt:r.acknowledgedAt,savedRecordUnavailable:!r.disk,hasDifferences:!!r.disk && hasRecoveryDifference(r.draft.workspace,r.disk.workspace),filename:r.draft.workspace.document.filename});
    }
    return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async reviewRecovery(id: string): Promise<RecoveryRecord> {
    return this.serialize(async () => {
      const r = await this.getRecovery(id);
      const current = await this.maybeEntry(r.resultEntryId ?? r.entryId);
      if (r.state === 'resolved') return {...r, current: current ? this.snapshot(current) : null};
      if (!r.intent && (current?.version ?? null) !== (r.disk?.version ?? null)) {
        if (r.disk && (!current || hasRecoveryDifference(r.disk.workspace,current.workspace))) r.previous.push(r.disk);
        r.disk=current ? this.snapshot(current) : null;
        await this.saveRecovery(r);
      }
      return r;
    });
  }
  async acknowledgeRecovery(id: string): Promise<RecoveryRecord> {
    return this.serialize(async () => {
      const r = await this.getRecovery(id);
      if (r.state !== 'resolved') return fail('请先选择要继续使用的记录。', 409, 'recovery_pending');
      if (!await this.maybeEntry(r.resultEntryId ?? r.entryId)) return fail('当前已保存记录暂时无法读取，未结束提醒。', 409, 'recovery_unavailable');
      if (!r.acknowledgedAt) { r.acknowledgedAt = now(); await this.saveRecovery(r); }
      return r;
    });
  }
  private snapshot(e: LibraryEntry): RecoverySnapshot {
    return {workspace:e.workspace,position:e.position,revisionId:e.revisionId,version:e.version};
  }
  private async maybeEntry(id: string) {
    try { return await this.get(id); } catch (e) {
      if (e instanceof LibraryError && e.code === "entry_unreadable") return null;
      throw e;
    }
  }
  async recover(id: string, value: unknown): Promise<RecoveryResult> {
    if (!uid(id)) return fail("阅读条目不存在。", 404);
    const v = value as Partial<ReadingDraft> | null;
    if (!v || v.entryId !== id || !Number.isSafeInteger(v.version) || v.version! < 1 || !uid(v.revisionId)
      || (v.id !== undefined && !uid(v.id)) || (v.baseDigest !== undefined && !/^[a-f0-9]{64}$/.test(v.baseDigest))) return fail("恢复记录格式无效。");
    const draft: ReadingDraft = { ...(v.id ? {id:v.id} : {}), entryId:id, version:v.version!, revisionId:v.revisionId!,
      ...(v.baseDigest ? {baseDigest:v.baseDigest} : {}), workspace:safeWorkspace(v.workspace), position:position(v.position) };
    await this.resources.validate(id,draft.workspace);
    // Include content: reusing a client ID for a different snapshot must not lose either one.
    const recoveryId = hash(JSON.stringify([id,draft.id,draft.revisionId,readingContent(draft.workspace),viewKey(draft.workspace,draft.position)]));
    return this.serialize(async () => {
      try { const existing = await this.getRecovery(recoveryId); return {kind:"review",record:existing}; }
      catch (e) { if (!(e instanceof LibraryError) || e.code !== "recovery_missing") throw e; }
      const e = await this.maybeEntry(id);
      if (e && sameOriginal(e,draft)) {
        const same = readingContent(e.workspace) === readingContent(draft.workspace);
        if (same) {
          if (same && viewKey(e.workspace,e.position) === viewKey(draft.workspace,draft.position)) return {kind:"same",entry:e};
          e.workspace = withPreferences(same ? {...e.workspace,activeInquiryId:draft.workspace.activeInquiryId,activeTab:draft.workspace.activeTab} : draft.workspace,e.workspace);
          e.position = draft.position; e.version++; e.updatedAt = now();
          return {kind:"same",entry:await this.commit(e)};
        }
      }
      const record: RecoveryRecord = {id:recoveryId,entryId:id,createdAt:now(),state:"pending",draft,disk:e ? this.snapshot(e) : null,previous:[],reason:!e ? "unreadable" : draft.baseDigest ? "changed" : "unknown"};
      await this.saveRecovery(record); return {kind:"review",record};
    });
  }
  async resolveRecovery(id: string, choice: unknown, expectedVersion: unknown): Promise<{record: RecoveryRecord; entry: LibraryEntry}> {
    if (choice !== "draft" && choice !== "disk") return fail("请选择要继续的阅读记录。");
    return this.serialize(async () => {
      const r = await this.getRecovery(id);
      if (r.state === "resolved") return {record:r,entry:await this.get(r.resultEntryId!)};
      let current = await this.maybeEntry(r.entryId);
      // A committed target carries the operation ID, even if final acknowledgement was lost.
      if (r.intent) {
        const applied = await this.maybeEntry(r.intent.target.id);
        if (applied?.recoveryOperationId === r.id) {
          r.state="resolved";r.choice=r.intent.choice;r.resultEntryId=applied.id;delete r.intent;
          await this.saveRecovery(r);return {record:r,entry:applied};
        }
      }
      const actualVersion = current?.version ?? null;
      if (actualVersion !== expectedVersion || (r.intent && r.intent.expectedVersion !== actualVersion)) {
        if (r.disk) r.previous.push(r.disk);
        r.disk=current ? this.snapshot(current) : null; delete r.intent;
        await this.saveRecovery(r);
        return fail("已保存记录再次变化，请重新查看差异后选择。",409,"recovery_changed");
      }
      if (choice === "disk" && !current) return fail("已保存记录无法读取，请选择可读的阅读记录。");
      if (r.intent && r.intent.choice !== choice) return fail("上次选择尚未完成，请重试上次选择。",409);
      if (!r.intent) {
        let target: LibraryEntry;
        if (choice === "disk") target = {...current!,version:current!.version+1};
        else if (current && sameOriginal(current,r.draft)) target = {...current,workspace:withPreferences(r.draft.workspace,current.workspace),position:r.draft.position,version:current.version+1,updatedAt:now()};
        else target = {id:randomUUID(),version:1,revisionId:randomUUID(),source:null,workspace:r.draft.workspace,position:r.draft.position,history:[],updatedAt:now(),lastOpenedAt:now(),creationKey:`recovery:${r.id}`};
        target.recoveryOperationId = r.id;
        r.intent = {choice,expectedVersion:actualVersion,target};
        await this.saveRecovery(r);
      }
      await this.resources.clone(r.entryId,r.intent.target.id,r.intent.target.workspace);
      const entry = await this.commit(r.intent.target);
      r.state="resolved";r.choice=r.intent.choice;r.resultEntryId=entry.id;delete r.intent;
      await this.saveRecovery(r); return {record:r,entry};
    });
  }
  async check(id: string): Promise<SourceCheck> {
    const e = await this.get(id);
    if (!e.source) return { status: "unlinked", message: "未关联原文件 · 当前为保存的阅读副本" };
    try {
      const c = await this.readSource(e.source.path, e.source.realPath);
      if (c.source!.hash === e.source.hash) return { status: "available", message: "原文件可用" };
      return { status: "changed", message: "原文件内容已变化，当前显示保存版本。", candidateId: this.ticket({ ...c, entryId: id }) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return { status: "missing", message: "找不到原文件，请重新定位。当前显示保存版本。" };
      if (code === "EACCES" || code === "EPERM") return { status: "permission", message: "没有权限读取原文件。当前显示保存版本。" };
      if (code === "source_reselect") return { status: "reselect", message: "原路径指向其他文件，请重新定位。" };
      return { status: "unreadable", message: "原文件暂时无法读取。当前显示保存版本，可重试。" };
    }
  }
  async relink(id: string, selectionId: string, expectedVersion: number): Promise<{ entry: LibraryEntry; check: SourceCheck }> {
    return this.serialize(async () => {
      const e = await this.get(id); this.version(e, expectedVersion);
      const c = this.consume(selectionId);
      if(!c.source||(e.workspace.document.kind==="pdf"?!c.workspace:!c.filename.toLowerCase().endsWith(".md")))return fail("请选择同格式的原始文件，不要选择备份文件。");
      await this.noDuplicateSource(id, c.source);
      if ((e.workspace.document.kind==="pdf"?e.workspace.document.contentHash:hash(e.workspace.document.markdown)) !== c.source.hash) return { entry: e, check: { status: "changed", message: "所选文件与保存版本不同，请确认是否更新。", candidateId: this.ticket({ ...c, entryId: id }) } };
      if(c.workspace?.document.kind==="pdf")await this.resources.grant(id,c.workspace.document.pdf.resourceId);
      e.source = c.source; e.version++; await this.commit(e); return { entry: e, check: { status: "available", message: "已重新关联原文件" } };
    });
  }
  private async noDuplicateSource(id: string, source: LibrarySource) {
    for (const s of (await this.list()).entries) if (s.id !== id) { const other = await this.get(s.id); if (other.source?.realPath === source.realPath) fail("此文件已属于另一阅读条目，请打开已有条目。", 409); }
  }
  async updateSource(id: string, candidateId: string, expectedVersion: number) {
    return this.serialize(async () => {
      const e = await this.get(id); this.version(e, expectedVersion);
      const c=this.consume(candidateId,id);if(!c.source)return fail("原始路径不可用，请重新选择。");
      const fresh=await this.readSource(c.source.path,c.source.realPath);
      if (fresh.source!.hash !== c.source.hash) fail("原文件再次变化，请重新检查并确认。", 409);
      await this.noDuplicateSource(id, c.source);
      const workspace = fresh.workspace ?? await readDocumentFile({ name: c.filename, size: Buffer.byteLength(c.content), text: async () => c.content });
      if(workspace.document.kind==="pdf")await this.resources.grant(id,workspace.document.pdf.resourceId);
      await this.resources.validate(id,workspace);
      e.history.push({ id: e.revisionId, savedAt: now(), workspace: e.workspace, position: e.position });
      e.revisionId = randomUUID(); e.workspace = workspace; e.position = { ratio: 0 }; e.source = c.source; e.version++; e.updatedAt = now();
      return this.commit(e);
    });
  }
}
export function libraryFailure(error: unknown) {
  if (error instanceof LibraryError) return error;
  return new LibraryError("本机阅读操作失败，请检查文件或保存目录权限后重试。", 503);
}
