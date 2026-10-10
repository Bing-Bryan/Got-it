import { useMemo } from "react";
import type { ThreadMessage } from "./types";
import { SourceCard } from "./SourceCard";
import { safeSourceUrl, SEARCH_LABELS } from "./lib/evidence";
import { lacksReadingBasis, sourceLimitations, readingLimitText } from "./lib/source-reading";
import { VERDICT_LABELS } from "./lib/verification";
import { renderMarkdown } from "./lib/markdown";

export function verificationBrief(message: ThreadMessage, failure?: string) {
  const v = message.verification;
  const complete = !failure && message.mode !== "demo" && message.completion !== "interrupted" && message.completion !== "provisional" && v?.completion === "complete" && v.verdict !== "incomplete" && message.search?.status === "executed";
  const sources = (message.sources ?? []).filter(source => safeSourceUrl(source.url));
  const searchFailed = message.search?.status === "failed" && message.completion !== "provisional" && v?.completion !== "provisional";
  const stopped = message.completion === "interrupted" || v?.completion === "interrupted";
  const failed = searchFailed || !!failure;
  const pending = message.completion === "provisional" || v?.completion === "provisional";
  const retained = sources.length ? "，已收到的参考资料已保留" : "";
  if (message.mode === "demo") return { complete: false, conclusion: "这是演示来源，没有执行真实查找。", limitation: "" };
  if (stopped || failed) return { complete: false, conclusion: `${stopped ? "本次查找已中断" : "本次查找失败"}${retained}。`, limitation: failure || "" };
  if (pending) return { complete: false, conclusion: "正在查找来源，当前内容尚待核对。", limitation: "" };
  if (message.search?.status !== "executed") {
    const reason = message.search?.status === "not-executed" ? "这份记录没有执行联网搜索。" : "现有记录无法确认是否执行了搜索。";
    return { complete: false, conclusion: `${reason}${sources.length ? "已有参考资料可查看，但记录不足以确认与原文的对应关系。" : "不能据此判断原文有无出处。"}`, limitation: "" };
  }
  if (!complete || !v) return { complete: false, conclusion: sources.length ? "已有参考资料，但记录中缺少完整的对应关系说明。" : "这份查找记录没有可展示的资料，现有信息不足以说明出处。", limitation: "" };
  if (lacksReadingBasis(v, sources)) return { complete, conclusion: sources.length ? "已保留参考资料，但不足以确认原句的完整结论。" : "现有记录不足以确认原句的依据。", limitation: sourceLimitations(sources, v) };
  // The server reconciles these fields against source checks. Filter retired
  // workflow instructions from legacy readingAdvice alongside useful restrictions.
  const summary = v.summary.trim();
  const reason = readingLimitText(v.reason, v.readingAdvice);
  return { complete, conclusion: summary || (sources.length ? "有参考资料。" : "本次没有定位到对应出处。"), limitation: reason && reason !== summary ? reason : "" };
}

export function VerificationAnswer({ message, failure, history = false }: { message: ThreadMessage; failure?: string; history?: boolean }) {
  const brief = verificationBrief(message, failure);
  const v = message.verification;
  const original = useMemo(() => renderMarkdown(message.content), [message.content]);
  const streaming = !failure && message.search?.status !== "failed" && message.completion === "provisional" && !v;
  return <>
    <section className="verification-summary verification-brief" aria-label="来源查找结果" aria-live="polite">
      <p className="verification-conclusion">{brief.conclusion}</p>
      {brief.limitation ? <p className="verification-limitation">{brief.limitation}</p> : null}
      {streaming ? <div className="answer-markdown" dangerouslySetInnerHTML={{ __html: original.html }} /> : null}
      {!v && !streaming && !history && message.content.trim() ? <details className="verification-record"><summary>原有回答（未核对）</summary><div className="answer-markdown" dangerouslySetInnerHTML={{ __html: original.html }} /></details> : null}
    </section>
    {message.sources?.length || history ? <section className="source-section compact-sources" aria-label="来源列表">
      {message.sources?.map(source => <SourceCard key={source.id} source={source} />)}
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
