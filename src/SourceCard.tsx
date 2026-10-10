import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import type { Source } from "./types";
import { safeSourceUrl, sourceLocation } from "./lib/evidence";

export function SourceCard({ source }: { source: Source }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const url = safeSourceUrl(source.url);
  const excerpt = source.excerpt?.trim() || source.snippet?.trim();
  const quote = !!url && !!source.excerpt?.trim() && source.excerptKind === "quote" && source.retrievalStatus === "matched";
  const destination = quote ? sourceLocation(source) ?? url : url;
  const label = !excerpt ? "未取得片段" : quote ? "片段已核对" : source.excerptKind === "summary" ? "搜索摘要，未核对正文" : "片段未核对";
  const boundary = !excerpt ? "未取得可展示的原文片段。"
    : !quote && source.excerptKind !== "summary" ? "AI 提供的引用线索" : undefined;
  const copy = async () => {
    try { await navigator.clipboard.writeText(source.excerpt!); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  return <section className="source-evidence-card source-reading-card" aria-label={`来源：${source.title}`}>
    <div className="source-evidence-heading">
      <strong>{source.publisher || (url ? new URL(url).hostname : source.title)}{source.publishedAt ? <span> · {source.publishedAt}</span> : null}</strong>
    </div>
    <div className="source-card-title">
      <p className="source-brief">{source.title}</p>
      {destination ? <a href={destination} target="_blank" rel="noreferrer noopener">打开来源 <ExternalLink size={12} aria-hidden="true" /></a> : <small>来源链接不可用</small>}
    </div>
    <div className="source-full-details">
      <div className="source-reading-status">
        <span className={`excerpt-label ${quote ? "verified" : ""}`}>{label}</span>
        {boundary ? <p className="source-reading-boundary">{boundary}</p> : null}
      </div>
      {excerpt ? <blockquote>{excerpt}</blockquote> : null}
      {quote ? <div className="source-actions"><button type="button" onClick={() => void copy()}><Copy size={12} />复制引用</button></div> : null}
      {copyState !== "idle" ? <p className="copy-feedback" role="status">{copyState === "copied" ? "引用已复制" : "复制未成功，请选中上方引用文字手动复制。"}</p> : null}
    </div>
  </section>;
}
