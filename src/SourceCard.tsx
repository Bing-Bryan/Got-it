import { RELIABILITY_LABELS, APPLICABILITY_LABELS } from "./lib/verification";
import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import type { Source } from "./types";
import { EXCERPT_LABELS, RELATION_LABELS, RETRIEVAL_LABELS, safeSourceUrl, sourceLocation } from "./lib/evidence";

export function SourceCard({ source, sourceFirst = false, explanation = false }: { source: Source; sourceFirst?: boolean; explanation?: boolean }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const url = safeSourceUrl(source.url);
  const location = sourceLocation(source);
  const excerpt = source.excerpt ?? source.snippet;
  const quote = source.excerptKind === "quote" && source.retrievalStatus === "matched";
  const copy = async () => {
    try { await navigator.clipboard.writeText(excerpt ?? ""); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  return <section className="source-evidence-card" aria-label={`来源：${source.title}`}>
    <div className="source-evidence-heading">
      <strong>{source.publisher || (url ? new URL(url).hostname : source.title)}{source.publishedAt ? <span> · {source.publishedAt}</span> : null}</strong>
      {url ? <a href={url} target="_blank" rel="noreferrer noopener">打开原文</a> : <small>来源链接不可用</small>}
    </div>
    {sourceFirst ? <p className="source-brief">{source.title}</p> : <p className="source-brief">{source.differences?.[0] || source.scope || (source.relation === "conflicts" ? "材料与原句存在冲突，展开查看具体内容。" : "材料的适用范围尚未说明，不能直接作为充分依据。")}</p>}
    <details className="source-full-details">
    <summary>查看详情</summary>
    {!sourceFirst ? <strong>{source.title}</strong> : null}
    <small className="source-details">{url ? new URL(url).hostname : "来源链接不可用"}</small>
    {!sourceFirst ? <>
    <div className="source-assessment">
      <strong>可靠性评估：{source.reliability ? RELIABILITY_LABELS[source.reliability] : "尚未评估"}</strong>
      <p>{source.reliabilityReasons?.join("；") || "尚无可审查的可靠性理由。"}</p>
      <p>适用关系：{APPLICABILITY_LABELS[source.applicability ?? "unknown"]}</p>
      <p>适用范围：{source.scope || "尚未说明"}</p>
      {source.differences?.length ? <p>与原句的差异：{source.differences.join("；")}</p> : null}
    </div>
    </> : null}
    <span className={`excerpt-label ${quote ? "verified" : ""}`}>{EXCERPT_LABELS[quote ? "quote" : source.excerptKind === "summary" ? "summary" : "unverified"]}</span>
    {excerpt ? <blockquote>{excerpt}</blockquote> : <p>未取得可展示的原文片段。</p>}
    {!sourceFirst ? <p className="source-relation">{RELATION_LABELS[source.relation ?? "unknown"]}</p> : null}
    {!sourceFirst ? <small className="source-details">{RETRIEVAL_LABELS[source.retrievalStatus ?? "not-read"]} · {source.origin === "original" ? "原始来源" : source.origin === "secondary" ? "转载来源" : "原始出处未确认"}</small> : null}
    {source.publisher || source.publishedAt ? <small className="source-details">{[source.publisher, source.publishedAt].filter(Boolean).join(" · ")}</small> : null}
    <div className="source-actions">
      {url ? <a href={url} target="_blank" rel="noreferrer noopener"><ExternalLink size={12} />打开来源</a> : null}
      {location ? <a href={location} target="_blank" rel="noreferrer noopener">定位原文</a> : null}
      {quote && excerpt ? <button type="button" onClick={() => void copy()}><Copy size={12} />复制引用</button> : null}
    </div>
    {quote && !sourceFirst ? <small className="source-location-help">引用文字已核对只确认文字存在，不代表原句成立。定位取决于网页与浏览器；未跳转时可复制引用查找。</small> : null}
    {explanation ? <small className="source-details">{RETRIEVAL_LABELS[source.retrievalStatus ?? "not-read"]}</small> : null}
    {sourceFirst && !explanation ? <details className="verification-record"><summary>历史评估记录</summary>
    <div className="source-assessment">
      <strong>可靠性评估：{source.reliability ? RELIABILITY_LABELS[source.reliability] : "尚未评估"}</strong>
      <p>{source.reliabilityReasons?.join("；") || "尚无可审查的可靠性理由。"}</p>
      <p>适用关系：{APPLICABILITY_LABELS[source.applicability ?? "unknown"]}</p>
      <p>适用范围：{source.scope || "尚未说明"}</p>
      {source.differences?.length ? <p>与原句的差异：{source.differences.join("；")}</p> : null}
    </div>
    <p>{RELATION_LABELS[source.relation ?? "unknown"]}</p></details> : null}
    {copyState !== "idle" ? <p className="copy-feedback" role="status">{copyState === "copied" ? "引用已复制" : "复制未成功，请选中上方引用文字手动复制。"}</p> : null}
    </details>
  </section>;
}
