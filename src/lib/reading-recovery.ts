import type { Inquiry, Workspace } from '../types';
import type { LibraryEntry, ReadingPosition } from './library-types';
import { restoreWorkspace, sanitizeWorkspace } from './storage';
import { parseReadingDocument } from './reading-document-core';

export interface ReadingDraft {
  id?: string;
  entryId: string;
  version: number;
  revisionId: string;
  baseDigest?: string;
  workspace: Workspace;
  position: ReadingPosition;
}
export interface RecoverySnapshot { workspace: Workspace; position: ReadingPosition; revisionId: string; version: number }
export interface RecoveryRecord {
  id: string; entryId: string; createdAt: string; state: 'pending' | 'resolved';
  draft: ReadingDraft; disk: RecoverySnapshot | null; previous: RecoverySnapshot[];
  reason: 'changed' | 'unknown' | 'unreadable';
  choice?: 'draft' | 'disk'; resultEntryId?: string;
  intent?: { choice: 'draft' | 'disk'; expectedVersion: number | null; target: LibraryEntry };
}
export type RecoverySummary = Pick<RecoveryRecord, 'id' | 'entryId' | 'createdAt' | 'state' | 'resultEntryId'> & { filename: string };
export type RecoveryResult = { kind: 'same' | 'restored'; entry: LibraryEntry } | { kind: 'review'; record: RecoveryRecord };

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function inquiryContent({ updatedAt: _updated, createdAt: _created, completedAt: _completed, ...inquiry }: Inquiry): string { return canonical(inquiry); }
/** The complete safe reading content, without navigation or bookkeeping timestamps. */
export function readingContent(workspace: Workspace): string {
  const w = restoreWorkspace(workspace)!;
  return canonical({ document: { id: w.document.id, filename: w.document.filename, ...(w.document.kind === "pdf" ? {kind:"pdf",pdf:w.document.pdf} : {markdown: w.document.markdown}) },
    inquiries: w.inquiries.map(inquiryContent) });
}
export function viewKey(w: Workspace, p: ReadingPosition): string {
  return canonical({ activeInquiryId: w.activeInquiryId, activeTab: w.activeTab, position: p });
}
export function readingKey(w: Workspace, p: ReadingPosition): string { return readingContent(w) + viewKey(w, p); }
export function sameOriginal(e: LibraryEntry | RecoverySnapshot, d: ReadingDraft): boolean {
  return e.revisionId === d.revisionId && e.workspace.document.id === d.workspace.document.id && e.workspace.document.contentHash === d.workspace.document.contentHash && e.workspace.document.kind === d.workspace.document.kind && e.workspace.document.markdown === d.workspace.document.markdown;
}
export function withPreferences(w: Workspace, preferences: Workspace): Workspace {
  return { ...w, activeProviderId: preferences.activeProviderId, modelPreferences: preferences.modelPreferences, modelDefaultsVersion: preferences.modelDefaultsVersion };
}
export const LEGACY_DRAFT_KEY = 'got-it.library.draft.v1';
export const DRAFT_PREFIX = 'got-it.library.draft.v2.';
export interface StoredDraft { key: string; raw: string; draft: ReadingDraft }
export class DraftStore {
  constructor(private storage: Storage, private owner: string = crypto.randomUUID()) {}
  write(e: LibraryEntry, workspace: Workspace, position: ReadingPosition): StoredDraft {
    const key = `${DRAFT_PREFIX}${this.owner}.${e.id}`;
    const previous = this.own(e.id);
    if (previous && previous.draft.version === e.version && previous.draft.revisionId === e.revisionId
      && readingKey(previous.draft.workspace,previous.draft.position) === readingKey(workspace,position)) return previous;
    const draft: ReadingDraft = { id: crypto.randomUUID(), entryId: e.id, version: e.version, revisionId: e.revisionId,
      ...(e.contentDigest ? { baseDigest: e.contentDigest } : {}), workspace: sanitizeWorkspace(workspace), position };
    const raw = JSON.stringify(draft); this.storage.setItem(key, raw); return { key, raw, draft };
  }
  remove(record: StoredDraft) { if (this.storage.getItem(record.key) === record.raw) this.storage.removeItem(record.key); }
  own(entryId: string): StoredDraft | undefined { return this.read().drafts.find(d=>d.key === `${DRAFT_PREFIX}${this.owner}.${entryId}`); }
  read(): { drafts: StoredDraft[]; invalid: boolean } {
    const drafts: StoredDraft[] = []; let invalid = false;
    const keys = Array.from({length:this.storage.length},(_,i)=>this.storage.key(i)).filter((key): key is string => !!key && (key === LEGACY_DRAFT_KEY || key.startsWith(DRAFT_PREFIX)));
    for (const key of keys) {
      const raw = this.storage.getItem(key); if (!raw) continue;
      try {
        const d = JSON.parse(raw) as ReadingDraft; const w = parseReadingDocument(JSON.stringify(d.workspace),true,true);
        if (!w || typeof d.entryId !== 'string' || !Number.isSafeInteger(d.version) || typeof d.revisionId !== 'string' || !Number.isFinite(d.position?.ratio)) throw new Error();
        drafts.push({key,raw,draft:{...d,workspace:w}});
      } catch { invalid = true; }
    }
    return { drafts, invalid };
  }
}
