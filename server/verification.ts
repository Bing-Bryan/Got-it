import type { InquiryRequest, InquiryResponse, Verification } from "../src/types";
import { canonicalUrl, copyVerification, legacyEvidence, rankSources } from "../src/lib/verification";

export function isVerification(request: InquiryRequest): boolean { return (request.operation ?? (request.intent === "verify" ? "verify" : "explain")) === "verify"; }
export function normalizeVerification(value: unknown, request: InquiryRequest, response: InquiryResponse): Verification {
  const v = copyVerification(value, response.sources) ?? copyVerification({}, [])!;
  return { ...v, round: request.round ?? 1, scope: request.scope ?? "initial", parentMessageId: request.parentMessageId, completion: "provisional" };
}
/** Never infer claim support from a matching quotation alone. */
export function reconcile(response: InquiryResponse, final: boolean): InquiryResponse {
  if (!response.verification) return response;
  const sources = rankSources(response.sources);
  const v = { ...response.verification, claims: response.verification.claims.map(c => ({ ...c, sourceIds: c.sourceIds.filter(id => sources.some(s => s.id === id)) })), completion: final ? "complete" as const : "provisional" as const };
  const traceable = (id: string, relation: "supports" | "conflicts") => sources.some(s => s.id === id && s.relation === relation && s.applicability === "direct" && !!s.scope && s.reliability !== "uncertain" && !!s.reliabilityReasons?.length && s.origin !== "secondary" && (!final || s.excerptKind === "quote" && s.retrievalStatus === "matched"));
  const searchConfirmed = response.search?.status === "executed";
  let downgraded = false;
  for (const c of v.claims) {
    const before = c.verdict;
    if (c.verdict === "supported" && (!searchConfirmed || !c.sourceIds.some(id => traceable(id, "supports")))) c.verdict = "partial";
    if (c.verdict === "conflicting" && (!searchConfirmed || !c.sourceIds.some(id => traceable(id, "conflicts")))) c.verdict = "insufficient";
    if (before !== c.verdict) downgraded = true;
  }
  if (v.verdict === "partial" && v.claims.length && v.claims.every(c => c.verdict === "insufficient" || c.verdict === "incomplete")) { v.verdict = "insufficient"; downgraded = true; }
  if (v.verdict === "supported" && (!searchConfirmed || !v.claims.length || !v.claims.every(c => c.verdict === "supported"))) { v.verdict = "partial"; downgraded = true; }
  if (v.verdict === "conflicting" && !v.claims.some(c => c.verdict === "conflicting")) { v.verdict = "insufficient"; downgraded = true; }
  if (!searchConfirmed) { v.verdict = "incomplete"; downgraded = true; }
  if (downgraded) {
    v.summary = v.verdict === "incomplete" ? "未联网核查或未能确认搜索成功，本轮查证未完成。" : "现有材料不足以确认原句的完整结论。";
    v.reason = !searchConfirmed ? "未确认成功搜索；不能把模型分析当作已完成查证。" : "部分子主张缺少范围直接匹配、可追溯且已核对的依据；相关背景或转载不能替代原句结论。";
    v.readingAdvice = "保留原句的不确定性；不要直接作为已确认事实引用，也不能据此认定整句错误。";
  }
  if (!final && v.verdict === "supported") {
    v.summary = "初步材料可能支持原句，引用文字仍在核对中。";
    v.readingAdvice = "等待最终结果；暂定判断不能当作确认结论。";
  }
  return { ...response, sources, verification: v, evidenceStatus: legacyEvidence(v.verdict), answer: [v.summary, v.reason, v.readingAdvice].join("\n\n") };
}
export function describeRound(response: InquiryResponse, request: InquiryRequest): InquiryResponse {
  const v = response.verification;
  if (!v || !request.previous) return response;
  const old = new Set(request.previous.sources.map(s => canonicalUrl(s.url)));
  const added = response.sources.filter(s => !old.has(canonicalUrl(s.url)) && s.origin !== "secondary" && s.reliability && s.reliability !== "uncertain");
  v.changeNote = added.length ? `本轮新增 ${added.length} 条有可靠性依据的资料；${request.previous.verification.verdict === v.verdict ? "结论未改变" : "结论有变化，请对照前轮"}。` : "本轮没有新增可靠依据。前轮结果与限制保留在上方。";
  return response;
}
