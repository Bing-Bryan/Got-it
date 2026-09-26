import { useMemo } from "react";
import type { ThreadMessage } from "./types";
import { SourceCard } from "./SourceCard";
import { safeSourceUrl, SEARCH_LABELS } from "./lib/evidence";
import { VERDICT_LABELS } from "./lib/verification";
import { renderMarkdown } from "./lib/markdown";

export function verificationBrief(message: ThreadMessage, failure?: string) {
  const v = message.verification;
  const complete = !failure && message.mode !== "demo" && message.completion !== "interrupted" && message.completion !== "provisional" && v?.completion === "complete" && v.verdict !== "incomplete" && message.search?.status === "executed";
  const sources = (message.sources ?? []).filter(source => safeSourceUrl(source.url));
  const matched = sources.some(source => source.retrievalStatus === "matched" && ["supports", "conflicts", "related"].includes(source.relation ?? "unknown"));
  const searchFailed = message.search?.status === "failed" && message.completion !== "provisional" && v?.completion !== "provisional";
  const unfinished = searchFailed || !!failure || message.completion === "interrupted" || v?.completion === "interrupted";
  const stopped = message.completion === "interrupted" || v?.completion === "interrupted";
  const incompleteLabel = stopped ? "本次查找已中断" : "本次查找未完成";
  const conclusion = unfinished ? `${incompleteLabel}${sources.length ? "，已找到的来源已保留" : ""}` : message.mode === "demo" ? "这是演示来源" : message.completion === "provisional" || v?.completion === "provisional" ? "正在查找相关来源" : sources.length ? matched ? "找到了相关来源" : "找到了可能相关的来源" : "暂未找到可查看的来源";
  return { complete, conclusion, limitation: "" };
}

export function VerificationAnswer({ message, failure, history = false }: { message: ThreadMessage; failure?: string; history?: boolean }) {
  const brief = verificationBrief(message, failure);
  const v = message.verification;
  const original = useMemo(() => renderMarkdown(message.content), [message.content]);
  const streaming = !failure && message.completion === "provisional" && !v;
  return <>
    <section className="verification-summary verification-brief" aria-label="来源查找结果" aria-live="polite">
      <p className="verification-conclusion">{brief.conclusion}</p>
      {brief.limitation ? <p className="verification-limitation">{brief.limitation}</p> : null}
      {streaming || (!v && !history) ? <div className="answer-markdown" dangerouslySetInnerHTML={{ __html: original.html }} /> : null}
    </section>
    {message.sources?.length || history ? <section className="source-section compact-sources" aria-label="来源列表">
      {message.sources?.map(source => <SourceCard key={source.id} source={source} sourceFirst />)}
      {history ? <div className="verification-record">
        <p>{SEARCH_LABELS[message.search?.status ?? "unknown"]}{message.search?.failedSearches ? ` · 失败的搜索 ${message.search.failedSearches} 次` : ""}</p>
        {failure ? <p>{failure}</p> : null}
        {v ? <>
          <p>第 {v.round} 轮 · {v.scope === "expanded" ? "扩大范围" : "首轮查证"} · {v.completion === "provisional" ? "暂定结果" : VERDICT_LABELS[v.verdict]}</p>
          <p>{v.summary}</p>
          <p>{v.reason}</p>
          <p>{v.readingAdvice}</p>
          {brief.complete && v.verdict === "insufficient" ? <p>本轮公开网页搜索可能未覆盖全部资料，未找到充分依据不代表原文错误。</p> : null}
          {v.changeNote ? <p>{v.changeNote}</p> : null}
          {v.claims.map((claim, index) => <div className="claim-review" key={index}><strong>{claim.text}</strong><p>{VERDICT_LABELS[claim.verdict]}</p></div>)}
        </> : <div className="answer-markdown" dangerouslySetInnerHTML={{ __html: original.html }} />}
      </div> : null}
    </section> : null}
  </>;
}
