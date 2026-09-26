import type { Workspace } from "../types";
import { createInitialWorkspace, stableHash } from "../sample";
import { restoreWorkspace, sanitizeWorkspace } from "./storage";

export const READING_DOCUMENT_FORMAT = "focus-stickies-reading-document";
export const MAX_READING_FILE_BYTES = 20 * 1024 * 1024;

function checkSize(bytes: number): void {
  if (bytes > MAX_READING_FILE_BYTES) throw new Error("文件超过 20 MB，请打开较小的文档。");
}

function uniqueIds(items: { id: string }[]): boolean {
  return items.every(item => item.id.trim().length > 0) && new Set(items.map(item => item.id)).size === items.length;
}

/** Reject broken identities; unresolved text anchors remain readable for relinking. */
function validLinks(workspace: Workspace): boolean {
  return !!workspace.document.id.trim() && uniqueIds(workspace.inquiries) && workspace.inquiries.every(inquiry => {
    const anchor = inquiry.anchor;
    return anchor.documentId === workspace.document.id && !!anchor.blockId.trim()
      && Number.isSafeInteger(anchor.start) && anchor.start >= 0
      && Number.isSafeInteger(anchor.end) && anchor.end >= anchor.start
      && uniqueIds(inquiry.messages)
      && inquiry.messages.every(message => !message.sources || uniqueIds(message.sources));
  });
}

export function hasRunningAnswers(workspace: Workspace): boolean {
  return workspace.inquiries.some(inquiry => inquiry.status === "answering" || inquiry.messages.some(message => message.completion === "provisional" || message.verification?.completion === "provisional"));
}

export function readingDocumentFilename(workspace: Workspace): string {
  return `${workspace.document.filename.replace(/\.(md|focus|json)$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-") || "阅读文档"}.focus`;
}

export function workspaceToReadingDocument(workspace: Workspace): string {
  // Restore a copy so a running response is interrupted only in the saved file.
  const snapshot = restoreWorkspace(sanitizeWorkspace(workspace));
  if (!snapshot || !validLinks(snapshot)) throw new Error("当前阅读数据不完整，无法保存阅读文档。");
  const content = JSON.stringify({ format: READING_DOCUMENT_FORMAT, version: 1, workspace: { ...snapshot, hasUnexportedChanges: false } }, null, 2) + "\n";
  checkSize(new TextEncoder().encode(content).byteLength);
  return content;
}

export function parseReadingDocument(content: string, allowLegacy = false): Workspace {
  checkSize(new TextEncoder().encode(content).byteLength);
  let data: unknown;
  try { data = JSON.parse(content.replace(/^\uFEFF/, "")); }
  catch { throw new Error("阅读文档无法读取：文件为空或已损坏。当前文档未替换。"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("这不是有效的阅读文档。");
  const record = data as Record<string, unknown>;
  let value: unknown;
  if (record.format === READING_DOCUMENT_FORMAT) {
    if (record.version !== 1) throw new Error("此阅读文档版本暂不支持，请使用支持该版本的阅读器。");
    value = record.workspace;
  } else if (allowLegacy && record.format === undefined && record.schemaVersion === 1) {
    value = record;
  } else {
    throw new Error("文件格式或版本不支持。请选择 .focus 阅读文档或此前导出的完整 JSON。");
  }
  const workspace = restoreWorkspace(value);
  if (!workspace || !validLinks(workspace)) throw new Error("阅读文档的数据或关联不完整，当前文档未替换。");
  if (workspace.activeInquiryId && !workspace.inquiries.some(inquiry => inquiry.id === workspace.activeInquiryId)) workspace.activeInquiryId = null;
  return { ...workspace, hasUnexportedChanges: false };
}

/** Read before replacing state: failures must never discard the current reading. */
export async function readDocumentFile(file: Pick<File, "name" | "size" | "text">): Promise<Workspace> {
  checkSize(file.size);
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!["md", "focus", "json"].includes(extension ?? "")) throw new Error("请选择 Markdown（.md）、阅读文档（.focus）或旧版完整 JSON 文件。");
  let content: string;
  try { content = await file.text(); }
  catch { throw new Error("文件读取失败，请重新选择。当前文档未替换。"); }
  if (extension !== "md") return parseReadingDocument(content, extension === "json");
  if (!content.trim()) throw new Error("这个 Markdown 文件是空的。");
  const importedAt = new Date().toISOString();
  return {
    ...createInitialWorkspace(),
    document: { id: `doc-${stableHash(`${file.name}:${content}`)}`, filename: file.name, markdown: content, importedAt, contentHash: stableHash(content), isDemo: false },
    updatedAt: importedAt, hasUnexportedChanges: false,
  };
}
