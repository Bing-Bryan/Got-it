import { VERDICT_LABELS, RELIABILITY_LABELS, APPLICABILITY_LABELS } from "./verification";
import { SEARCH_LABELS, RETRIEVAL_LABELS, EXCERPT_LABELS, RELATION_LABELS, safeSourceUrl } from "./evidence";
import type { Inquiry, ThreadMessage, Workspace } from "../types";
import { sanitizeWorkspace } from "./storage";

function markdownSafe(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function quoteMarkdown(value: string): string {
  const normalized = markdownSafe(value);
  return normalized
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function inlineCode(value: string): string {
  const longestRun = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${value}${fence}`;
}

function threadMessageMarkdown(message: ThreadMessage): string {
  const label = message.role === "user" ? "我" : "AI";
  const metadata = [
    message.explanationMode === "web" ? "联网补充" : message.explanationMode === "local" ? "基于原文解释" : message.explanationMode === "auto" ? "按需查阅资料的解释" : undefined,
    message.providerName,
    message.model,
    message.modelConfig?.reasoningEffort,
    message.mode === "demo" ? "演示模式" : undefined,
  ].filter(Boolean);
  const suffix = metadata.length > 0 ? `（${metadata.join(" · ")}）` : "";
  const body = markdownSafe(message.content).trim();
  const sources =
    message.sources && message.sources.length > 0
      ? `\n\n${message.sources
          .map((source) => {
            const url = safeSourceUrl(source.url);
            return [url ? `来源：[${source.title || source.domain}](${url})` : "来源链接不可用",
              RETRIEVAL_LABELS[source.retrievalStatus ?? "not-read"],
              RELATION_LABELS[source.relation ?? "unknown"],
              `可靠性评估：${source.reliability ? RELIABILITY_LABELS[source.reliability] : "尚未评估"}；理由：${source.reliabilityReasons?.join("；") || "尚无依据"}`,
              `适用关系：${APPLICABILITY_LABELS[source.applicability ?? "unknown"]}；范围：${source.scope || "未知"}；差异：${source.differences?.join("；") || "未说明"}`,
              source.excerpt || source.snippet ? `${EXCERPT_LABELS[source.excerptKind ?? "unverified"]}：\n${quoteMarkdown(source.excerpt ?? source.snippet ?? "")}` : "正文未取得",
            ].join("\n\n");
          })
          .join("\n")}`
      : "";
  const trace = message.role === "assistant" ? `\n\n搜索：${SEARCH_LABELS[message.search?.status ?? "unknown"]}；证据：${message.evidenceStatus ?? "未知"}` : "";
  const v = message.verification;
  const review = v ? `\n\n第 ${v.round} 轮 · ${v.scope} · ${v.completion}\n\n查证结果：${VERDICT_LABELS[v.verdict]} — ${v.summary}\n\n关键理由：${v.reason}\n\n对原句意味着什么：${v.readingAdvice}\n\n${v.claims.map(c => `${c.text}：${VERDICT_LABELS[c.verdict]}（来源 ${c.sourceIds.join("、") || "暂无"}）`).join("\n")}\n\n${v.changeNote || ""}` : "";
  return `**${label}** ${suffix}\n\n${body}${review}${trace}${sources}`;
}

function inquiryMarkdown(inquiry: Inquiry, index: number): string {
  const anchorLink = `focus-stickies://document/${encodeURIComponent(inquiry.anchor.documentId)}#${encodeURIComponent(inquiry.anchor.blockId)}`;
  const messages = inquiry.messages.length
    ? inquiry.messages.map(threadMessageMarkdown).join("\n\n")
    : "暂无对话记录。";
  const understanding = inquiry.understanding.trim();
  const headingPath = inquiry.anchor.headingPath.length
    ? `\n- 标题路径：${inquiry.anchor.headingPath.join(" → ")}`
    : "";

  return [
    `## 知识贴 ${index + 1} · ${inquiry.status}`,
    "",
    `- 意图：${inquiry.intent}`,
    `- 原文位置：${inquiry.anchor.start}–${inquiry.anchor.end}`,
    `- 状态：${inquiry.status}`,
    `- 原文回链：[回到原文](${anchorLink})`,
    `- 块 ID：${inlineCode(inquiry.anchor.blockId)}${headingPath}`,
    "",
    "### 原文锚点",
    "",
    quoteMarkdown(inquiry.anchor.quote),
    "",
    "### 我的问题",
    "",
    markdownSafe(inquiry.question),
    "",
    "### 讨论线程",
    "",
    messages,
    "",
    ...(understanding ? ["### 我的理解", "", understanding] : []),
  ].join("\n");
}

/**
 * Export the workspace as Markdown knowledge cards. The source document stays
 * immutable; each card links back to its document/block and carries its thread.
 */
export function workspaceToMarkdown(workspace: Workspace): string {
  if (workspace.document.kind === "pdf") throw new Error("PDF 暂不支持可携带导出，请从本机阅读列表回看。");
  const safe = sanitizeWorkspace(workspace);
  const cards = safe.inquiries.map(inquiryMarkdown).join("\n\n");
  return [
    `# Got-it · ${safe.document.filename}`,
    "",
    `- 文档 ID：${inlineCode(safe.document.id)}`,
    `- 导入时间：${safe.document.importedAt}`,
    `- 最近更新：${safe.updatedAt}`,
    "",
    cards || "暂无知识贴。",
    "",
  ].join("\n");
}

/** Export a portable JSON snapshot with the same safe field projection as storage. */
export function workspaceToJson(workspace: Workspace): string {
  if(workspace.document.kind === "pdf")throw new Error("PDF 暂不支持独立文本备份，请从本机阅读列表重开。");
  return `${JSON.stringify(sanitizeWorkspace(workspace), null, 2)}\n`;
}

/** Upper-case alias for callers using the conventional JSON spelling. */
export const workspaceToJSON = workspaceToJson;

/** Browser download helper; no-op in non-browser environments. */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/plain;charset=utf-8",
): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  const createObjectURL = URL.createObjectURL;
  if (typeof createObjectURL !== "function") return false;

  const blob = new Blob([content], { type: mimeType });
  const url = createObjectURL.call(URL, blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoke after the click has been dispatched so Chromium can begin the download.
  const revoke = () => URL.revokeObjectURL?.(url);
  if (typeof queueMicrotask === "function") queueMicrotask(revoke);
  else setTimeout(revoke, 0);
  return true;
}

export function downloadWorkspaceMarkdown(
  workspace: Workspace,
  filename = `${workspace.document.filename.replace(/\.md$/i, "")}-knowledge-cards.md`,
): void {
  downloadTextFile(filename, workspaceToMarkdown(workspace), "text/markdown;charset=utf-8");
}

export function downloadWorkspaceJson(
  workspace: Workspace,
  filename = `${workspace.document.filename.replace(/\.md$/i, "")}-got-it.json`,
): void {
  downloadTextFile(filename, workspaceToJson(workspace), "application/json;charset=utf-8");
}
