import { sourceAssessment } from "./verification";
import type { SearchTrace, Source } from "../types";

export const SEARCH_LABELS: Record<SearchTrace["status"], string> = {
  executed: "已执行搜索", failed: "搜索失败", "not-executed": "未执行搜索", unknown: "无法确认搜索状态",
};
export const EXCERPT_LABELS = { quote: "原文引用 · 引用文字已核对", summary: "搜索摘要，未核对正文", unverified: "未核对片段" };
export const RELATION_LABELS = { supports: "模型判断：支持主张", conflicts: "模型判断：与主张冲突", related: "相关但不足以支持", unknown: "与主张的关系待确认" };
export const RETRIEVAL_LABELS = { matched: "引用文字已核对", mismatch: "片段未匹配正文", unavailable: "正文未取得", unsupported: "此来源暂不支持正文核对", "not-read": "正文未读取" };

export function safeSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function sourceLocation(source: Source): string | undefined {
  const safe = safeSourceUrl(source.url);
  if (!safe || source.excerptKind !== "quote" || source.retrievalStatus !== "matched" || !source.locatable || !source.excerpt) return;
  const url = new URL(safe);
  if (/\.pdf$/i.test(url.pathname)) return;
  const anchor = url.hash.split(":~:")[0];
  const encoded = encodeURIComponent(source.excerpt).replace(/[-!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  url.hash = `${anchor}:~:text=${encoded}`;
  return url.href;
}

/** Explicit safe projection: runtime objects must not leak logs, bodies or keys. */
export function sourceEvidence(source: Source): Partial<Source> {
  const result: Partial<Source> = sourceAssessment(source);
  for (const key of ["excerpt", "checkedAt", "publisher", "publishedAt"] as const) {
    if (typeof source[key] === "string") result[key] = source[key].slice(0, key === "excerpt" ? 2000 : 300);
  }
  if (["quote", "summary", "unverified"].includes(source.excerptKind ?? "")) result.excerptKind = source.excerptKind;
  if (["matched", "mismatch", "unavailable", "unsupported", "not-read"].includes(source.retrievalStatus ?? "")) result.retrievalStatus = source.retrievalStatus;
  if (["supports", "conflicts", "related", "unknown"].includes(source.relation ?? "")) result.relation = source.relation;
  if (["original", "secondary", "unknown"].includes(source.origin ?? "")) result.origin = source.origin;
  if (["official", "reference"].includes(source.websiteRole ?? "")) result.websiteRole = source.websiteRole;
  if (typeof source.locatable === "boolean") result.locatable = source.locatable;
  return result;
}

export function copySearch(value: unknown): SearchTrace | undefined {
  if (!value || typeof value !== "object") return;
  const trace = value as SearchTrace;
  if (!["executed", "failed", "not-executed", "unknown"].includes(trace.status)) return;
  return {
    status: trace.status,
    completedSearches: Number.isSafeInteger(trace.completedSearches) && trace.completedSearches >= 0 ? trace.completedSearches : 0,
    failedSearches: Number.isSafeInteger(trace.failedSearches) && trace.failedSearches >= 0 ? trace.failedSearches : 0,
  };
}
