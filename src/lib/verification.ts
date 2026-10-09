import { copyModelConfig } from "./model-routing";
import type { EvidenceStatus, InquiryOperation, InquiryTimings, Source, ThreadMessage, Verification, Verdict } from "../types";
import { safeSourceUrl } from "./evidence";

export const VERDICT_LABELS: Record<Verdict, string> = { supported: "找到直接支持", partial: "仅部分支持", conflicting: "发现相反证据", insufficient: "未找到充分依据", incomplete: "查证未完成" };

export function verificationReadingAdvice(message: ThreadMessage): string {
  const verification = message.verification;
  if (!verification) return "";
  if (verification.completion !== "complete" || message.completion === "interrupted") return verification.readingAdvice;
  if (message.mode === "demo") return "这是演示内容，没有实际联网查证，不能据此判断原句是否可靠。";
  const search = message.search?.status ?? "unknown";
  if (search !== "executed") {
    const reason = search === "failed" ? "本次联网搜索失败" : search === "not-executed" ? "本次没有执行联网搜索" : "本次无法确认联网搜索是否成功";
    return `${reason}，还不能判断原句是否可靠。这不等于网上没有答案；可以点击“再找一下”重新尝试。`;
  }
  if (verification.verdict === "incomplete") return "本轮已执行搜索，但尚未形成完整查证结果，暂时不能判断原句是否可靠。可以点击“再找一下”重新尝试。";
  if (verification.verdict === "insufficient") return `${verification.readingAdvice} 本轮公开网页搜索未找到足够证据；搜索可能未覆盖全部资料，不能据此认定原文错误。`;
  return verification.readingAdvice;
}
export const RELIABILITY_LABELS = { strong: "较强依据", moderate: "一定依据", uncertain: "尚难判断" };
export const APPLICABILITY_LABELS = { direct: "直接适用", partial: "部分适用", background: "相关背景", irrelevant: "不相关", unknown: "适用关系待确认" };
export const text = (v: unknown, limit = 600): string => typeof v === "string" ? v.trim().slice(0, limit) : "";
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const strings = (v: unknown): string[] => Array.isArray(v) ? v.slice(0, 8).map(v => text(v)).filter(Boolean) : [];
const verdict = (v: unknown): Verdict => typeof v === "string" && Object.hasOwn(VERDICT_LABELS, v) ? v as Verdict : "incomplete";
export function legacyEvidence(v: Verdict): EvidenceStatus { return v === "supported" ? "supported" : v === "conflicting" || v === "insufficient" ? "unsupported" : "partial"; }
export function sourceAssessment(value: unknown): Partial<Source> {
  const v = record(value);
  if (!["reliability", "applicability", "scope", "reliabilityReasons", "differences"].some(k => k in v)) return {};
  const reasons = strings(v.reliabilityReasons), scope = text(v.scope);
  return {
    reliability: reasons.length && scope && ["strong", "moderate"].includes(String(v.reliability)) ? v.reliability as "strong" | "moderate" : "uncertain",
    reliabilityReasons: reasons, scope, differences: strings(v.differences),
    applicability: ["direct", "partial", "background", "irrelevant"].includes(String(v.applicability)) ? v.applicability as Source["applicability"] : "unknown",
  };
}
export function copyVerification(value: unknown, sources: Source[] = []): Verification | undefined {
  if (!value || typeof value !== "object") return;
  const v = record(value), ids = new Set(sources.map(s => s.id));
  return {
    verdict: verdict(v.verdict), summary: text(v.summary) || "当前材料不足以形成完整判断。",
    reason: text(v.reason) || "尚缺少可核对依据。", readingAdvice: text(v.readingAdvice) || "先保留原句的不确定性，不作为已确认事实引用。",
    claims: Array.isArray(v.claims) ? v.claims.slice(0, 8).map(c => { const r = record(c); return { text: text(r.text), verdict: verdict(r.verdict), sourceIds: strings(r.sourceIds).filter(id => ids.has(id)) }; }).filter(c => c.text) : [],
    round: Number.isSafeInteger(v.round) && Number(v.round) > 0 ? Math.min(Number(v.round), 1000) : 1,
    scope: v.scope === "expanded" ? "expanded" : "initial",
    completion: v.completion === "complete" ? "complete" : v.completion === "provisional" ? "provisional" : "interrupted",
    ...(text(v.parentMessageId, 200) ? { parentMessageId: text(v.parentMessageId, 200) } : {}),
    ...(text(v.changeNote) ? { changeNote: text(v.changeNote) } : {}),
  };
}
export function copyOperation(value: unknown): InquiryOperation {
  const v = record(value);
  return {
    ...(copyModelConfig(v.modelConfig) ? { modelConfig: copyModelConfig(v.modelConfig) } : {}),
    ...(v.explanationMode === "local" || v.explanationMode === "web" || v.explanationMode === "auto" ? { explanationMode: v.explanationMode } : {}),
    ...(v.operation === "explain" || v.operation === "verify" || v.operation === "entity" || v.operation === "ask" ? { operation: v.operation } : {}),
    ...(v.scope === "initial" || v.scope === "expanded" ? { scope: v.scope } : {}),
    ...(Number.isSafeInteger(v.round) && Number(v.round) > 0 ? { round: Math.min(Number(v.round), 1000) } : {}),
    ...(text(v.parentMessageId, 200) ? { parentMessageId: text(v.parentMessageId, 200) } : {}),
  };
}
export function copyTimings(value: unknown): InquiryTimings | undefined {
  const v = record(value);
  if (typeof v.accepted !== "number" || !Number.isFinite(v.accepted) || v.accepted < 0) return;
  const out: InquiryTimings = { accepted: v.accepted };
  for (const k of ["firstProgress", "firstText", "preliminary", "complete", "sourceCheckMs"] as const) if (typeof v[k] === "number" && Number.isFinite(v[k]) && v[k] >= 0) out[k] = v[k];
  return out;
}
export function canonicalUrl(value: string): string {
  const safe = safeSourceUrl(value); if (!safe) return "";
  const url = new URL(safe); url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  return url.href.replace(/\/$/, "");
}
export function rankSources(sources: Source[]): Source[] {
  const reliability = { strong: 0, moderate: 1, uncertain: 2 }, applicability = { direct: 0, partial: 1, background: 2, unknown: 3, irrelevant: 4 };
  const seen = new Set<string>();
  return sources.filter(s => s.applicability !== "irrelevant" && safeSourceUrl(s.url))
    .map(s => ({ ...s, ...sourceAssessment(s) }))
    .sort((a, b) => reliability[a.reliability ?? "uncertain"] - reliability[b.reliability ?? "uncertain"] || applicability[a.applicability ?? "unknown"] - applicability[b.applicability ?? "unknown"])
    .filter(s => { const key = canonicalUrl(s.url); if (seen.has(key)) return false; seen.add(key); return true; });
}
