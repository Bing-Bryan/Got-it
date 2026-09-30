import { copyPdfDocument, copyPdfLocation, insidePage } from "./pdf-data";
import { copyActiveTab } from "./inquiry-tabs";
import { copyModelPreferences } from "./model-routing";
import { copyOperation, copyVerification, copyTimings } from "./verification";
import { interruptMessage } from "./inquiry-stream";
import { sourceEvidence, copySearch } from "./evidence";
import {
  SCHEMA_VERSION,
  type Anchor,
  type DocumentSnapshot,
  type Inquiry,
  type ProviderId,
  type Source,
  type ThreadMessage,
  type Workspace,
} from "../types";

/** Versioned key kept stable so a future schema can migrate or reject it. */
export const WORKSPACE_STORAGE_KEY = "focus-stickies.workspace.v1";
/** Backwards-friendly alias for callers that prefer a shorter name. */
export const STORAGE_KEY = WORKSPACE_STORAGE_KEY;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StorageResult = { ok: true } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): value is string {
  return typeof value === "string";
}

function providerId(value: unknown): value is ProviderId {
  return value === "codex" || value === "deepseek" || value === "demo";
}

function isAnchor(value: unknown): value is Anchor {
  if (!isRecord(value) || (value.pdf !== undefined && !copyPdfLocation(value.pdf))) return false;
  return (
    stringField(value.documentId) &&
    stringField(value.blockId) &&
    Array.isArray(value.headingPath) &&
    value.headingPath.every(stringField) &&
    stringField(value.quote) &&
    stringField(value.prefix) &&
    stringField(value.suffix) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    (value.matchStatus === "matched" || value.matchStatus === "needs-relink")
  );
}

function isDocument(value: unknown): value is DocumentSnapshot {
  if (!isRecord(value)) return false;
  return (
    stringField(value.id) &&
    stringField(value.filename) &&
    (value.kind === "pdf" ? !!copyPdfDocument(value.pdf) && value.contentHash === (value.pdf as {resourceId:string}).resourceId : (value.kind === undefined || value.kind === "markdown") && stringField(value.markdown)) &&
    stringField(value.importedAt) &&
    stringField(value.contentHash) &&
    typeof value.isDemo === "boolean"
  );
}

function isSource(value: unknown): value is Source {
  if (!isRecord(value)) return false;
  return (
    stringField(value.id) &&
    stringField(value.title) &&
    stringField(value.url) &&
    stringField(value.domain) &&
    (value.snippet === undefined || stringField(value.snippet)) &&
    ["excerpt", "checkedAt", "publisher", "publishedAt"].every((key) => value[key] === undefined || stringField(value[key])) &&
    (value.excerptKind === undefined || ["quote", "summary", "unverified"].includes(String(value.excerptKind))) &&
    (value.retrievalStatus === undefined || ["matched", "mismatch", "unavailable", "unsupported", "not-read"].includes(String(value.retrievalStatus))) &&
    (value.relation === undefined || ["supports", "conflicts", "related", "unknown"].includes(String(value.relation))) &&
    (value.origin === undefined || ["original", "secondary", "unknown"].includes(String(value.origin))) &&
    (value.locatable === undefined || typeof value.locatable === "boolean")
  );
}

function isMessage(value: unknown): value is ThreadMessage {
  if (!isRecord(value)) return false;
  return (
    stringField(value.id) &&
    (value.role === "user" || value.role === "assistant") &&
    stringField(value.content) &&
    stringField(value.createdAt) &&
    (value.sources === undefined || (Array.isArray(value.sources) && value.sources.every(isSource))) &&
    (value.evidenceStatus === undefined ||
      value.evidenceStatus === "supported" ||
      value.evidenceStatus === "partial" ||
      value.evidenceStatus === "unsupported" ||
      value.evidenceStatus === "not-applicable") &&
    (value.mode === undefined || value.mode === "live" || value.mode === "demo") &&
    (value.providerId === undefined || providerId(value.providerId)) &&
    (value.providerName === undefined || stringField(value.providerName)) &&
    (value.model === undefined || stringField(value.model)) &&
    (value.search === undefined || copySearch(value.search) !== undefined)
  );
}

function isInquiry(value: unknown): value is Inquiry {
  if (!isRecord(value)) return false;
  return (
    stringField(value.id) &&
    (value.intent === "explain" ||
      value.intent === "why" ||
      value.intent === "verify" ||
      value.intent === "entity") &&
    stringField(value.question) &&
    isAnchor(value.anchor) &&
    (value.status === "pending" ||
      value.status === "answering" ||
      value.status === "ready" ||
      value.status === "needs-verification" ||
      value.status === "understood" ||
      value.status === "distilled") &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    stringField(value.understanding) &&
    stringField(value.createdAt) &&
    stringField(value.updatedAt) &&
    (value.completedAt === undefined || stringField(value.completedAt)) &&
    (value.lastError === undefined || stringField(value.lastError))
  );
}

function isWorkspace(value: unknown): value is Workspace {
  if (!isRecord(value)) return false;
  return (
    (value.schemaVersion === 1 || value.schemaVersion === SCHEMA_VERSION) &&
    isDocument(value.document) &&
    Array.isArray(value.inquiries) &&
    value.inquiries.every(isInquiry) &&
    (value.activeInquiryId === null || stringField(value.activeInquiryId)) &&
    providerId(value.activeProviderId) &&
    stringField(value.updatedAt) &&
    typeof value.hasUnexportedChanges === "boolean"
  );
}

function optionalString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value;
}

function copyAnchor(anchor: Anchor): Anchor {
  return {
    ...(anchor.pdf ? { pdf: copyPdfLocation(anchor.pdf)! } : {}),
    ...(anchor.textVersion === 2 ? { textVersion: 2 as const } : {}),
    documentId: anchor.documentId,
    blockId: anchor.blockId,
    headingPath: [...anchor.headingPath],
    quote: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    start: anchor.start,
    end: anchor.end,
    matchStatus: anchor.matchStatus,
  };
}

function copySource(source: Source): Source {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    domain: source.domain,
    ...(source.snippet === undefined ? {} : { snippet: source.snippet }),
    ...sourceEvidence(source),
  };
}

function copyMessage(message: ThreadMessage): ThreadMessage {
  return {
    ...copyOperation(message),
    ...(copyVerification(message.verification, message.sources) ? { verification: copyVerification(message.verification, message.sources) } : {}),
    ...(copyTimings(message.timings) ? { timings: copyTimings(message.timings) } : {}),
    ...(["provisional", "complete", "interrupted"].includes(message.completion ?? "") ? { completion: message.completion } : {}),
    ...(typeof message.requestId === "string" ? { requestId: message.requestId.slice(0, 200) } : {}),
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(copySearch(message.search) ? { search: copySearch(message.search) } : {}),
    ...(message.sources === undefined ? {} : { sources: message.sources.map(copySource) }),
    ...(message.evidenceStatus === undefined ? {} : { evidenceStatus: message.evidenceStatus }),
    ...(message.mode === undefined ? {} : { mode: message.mode }),
    ...(message.providerId === undefined ? {} : { providerId: message.providerId }),
    ...(message.providerName === undefined ? {} : { providerName: message.providerName }),
    ...(message.model === undefined ? {} : { model: message.model }),
  };
}

function copyInquiry(inquiry: Inquiry): Inquiry {
  return {
    id: inquiry.id,
    intent: inquiry.intent,
    question: inquiry.question,
    anchor: copyAnchor(inquiry.anchor),
    status: inquiry.status,
    messages: inquiry.messages.map(copyMessage),
    understanding: inquiry.understanding,
    createdAt: inquiry.createdAt,
    updatedAt: inquiry.updatedAt,
    ...(inquiry.completedAt === undefined ? {} : { completedAt: inquiry.completedAt }),
    ...(inquiry.lastError === undefined ? {} : { lastError: inquiry.lastError }),
  };
}

/**
 * Project a runtime workspace onto the persisted schema.
 *
 * This explicit projection is intentional. It prevents an accidental
 * `providerKey`, API token, authorization header, or future runtime-only field
 * from being written even if a caller passes an object with extra properties.
 */
export function sanitizeWorkspace(workspace: Workspace): Workspace {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...(workspace.modelDefaultsVersion === 2 || workspace.modelDefaultsVersion === 3 ? { modelDefaultsVersion: workspace.modelDefaultsVersion } : {}),
    document: {
      id: workspace.document.id, filename: workspace.document.filename,
      importedAt: workspace.document.importedAt, contentHash: workspace.document.contentHash, isDemo: workspace.document.isDemo,
      ...(workspace.document.kind === 'pdf' ? {kind:'pdf' as const,pdf:copyPdfDocument(workspace.document.pdf)!} : {markdown:workspace.document.markdown}),
    },
    inquiries: workspace.inquiries.map(copyInquiry),
    activeInquiryId: workspace.activeInquiryId,
    ...(copyActiveTab(workspace.activeTab, workspace.inquiries) ? { activeTab: copyActiveTab(workspace.activeTab, workspace.inquiries) } : {}),
    ...(workspace.modelPreferences ? { modelPreferences: copyModelPreferences(workspace.modelPreferences) } : {}),
    activeProviderId: workspace.activeProviderId,
    updatedAt: workspace.updatedAt,
    hasUnexportedChanges: workspace.hasUnexportedChanges,
  };
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    // Browsers can expose localStorage but throw when storage is disabled.
    return null;
  }
}

/** Validate and restore a safe snapshot without replaying interrupted requests. */
export function restoreWorkspace(value: unknown): Workspace | null {
  if (!isWorkspace(value)) return null;
  if (value.inquiries.some(i => {
    if (value.document.kind !== 'pdf') return !!i.anchor.pdf;
    const a = i.anchor.pdf, page = a && value.document.pdf.pages[a.page-1];
    return !a || a.fileHash !== value.document.contentHash || !page || !a.rects.every(r=>insidePage(r,page));
  })) return null;
  const workspace = sanitizeWorkspace(value);
  workspace.inquiries = workspace.inquiries.map(inquiry => {
    const interrupted = inquiry.status === "answering" || inquiry.messages.some(m => m.completion === "provisional" || m.verification?.completion === "provisional");
    return interrupted ? { ...inquiry, status: "ready", lastError: "上次请求已中断；结果已保留，可手动重试。", messages: inquiry.messages.map(interruptMessage) } : inquiry;
  });
  return workspace;
}

/** Safely load the current schema; malformed or stale data is ignored. */
export function loadWorkspace(storage: StorageLike | null = getDefaultStorage()): Workspace | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
    return raw ? restoreWorkspace(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Save only the safe, versioned workspace projection. */
export function saveWorkspace(
  workspace: Workspace,
  storage: StorageLike | null = getDefaultStorage(),
): StorageResult {
  if (!storage) return { ok: false, error: "浏览器本地存储不可用。" };
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(sanitizeWorkspace(workspace)));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知存储错误";
    return { ok: false, error: `保存工作区失败：${message}` };
  }
}

/** Clear the current workspace without throwing when storage is unavailable. */
export function clearWorkspace(storage: StorageLike | null = getDefaultStorage()): StorageResult {
  if (!storage) return { ok: false, error: "浏览器本地存储不可用。" };
  try {
    storage.removeItem(WORKSPACE_STORAGE_KEY);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知存储错误";
    return { ok: false, error: `清空工作区失败：${message}` };
  }
}

