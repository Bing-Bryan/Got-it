import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { VerificationAnswer, verificationBrief } from "./VerificationAnswer";
import type { ThreadMessage } from "./types";
import { interruptMessage } from "./lib/inquiry-stream";

const message: ThreadMessage = {
  id: "m", role: "assistant", createdAt: "2026", content: "原回答", operation: "verify", completion: "complete", mode: "live",
  search: { status: "executed", completedSearches: 1, failedSearches: 0 },
  verification: { verdict: "partial", summary: "有报道提到约3000美元，但不是统一售价", reason: "报道对应特定渠道", readingAdvice: "仅可用于2024年特定渠道，不代表当前售价。", claims: [{text:"报价",verdict:"partial",sourceIds:["s1"]}], round: 2, scope: "expanded", completion: "complete" },
  sources: [{id:"s1",title:"完整报道标题",publisher:"示例媒体",publishedAt:"2024-02-26",url:"https://example.org/report",domain:"example.org",scope:"2024年渠道报价",applicability:"partial",differences:["不代表当前统一售价。"],excerpt:"A price of $3000",excerptKind:"quote",retrievalStatus:"matched",locatable:true,relation:"supports"}],
};

it("shows excerpts and left labels directly without a details or assessment fold", () => {
  const host=document.createElement("div"); host.innerHTML=renderToStaticMarkup(<VerificationAnswer message={message}/>);
  expect(host.querySelector('.verification-brief')?.textContent).toContain('不足以确认原句');
  expect(host.querySelector('.verification-limitation')?.textContent).toContain('2024年渠道报价');
  expect(host.querySelector('.verification-limitation')?.textContent).toContain('不代表当前统一售价');
  expect(host.querySelector('.source-assessment')).toBeNull();
  expect(host.querySelector('.source-evidence-card details')).toBeNull();
  expect(host.querySelector('.excerpt-label')?.textContent).toBe('片段已核对');
  expect(host.querySelector('.verification-brief')?.textContent).not.toMatch(/第 2 轮|关键理由|已执行搜索/);
  expect(host.querySelectorAll('details[open]')).toHaveLength(0);
  expect(host.querySelector('.compact-sources > summary')).toBeNull();
  expect(host.textContent).not.toContain('历史查证记录');
  expect(host.querySelector('.compact-sources > .verification-record')).toBeNull();
  expect(host.querySelector('.source-evidence-card')?.closest('details')).toBeNull();
  expect(host.querySelector('.source-evidence-heading')?.textContent).toContain('示例媒体 · 2024-02-26');
  expect(host.querySelector('.source-brief')?.textContent).toBe('完整报道标题');
  expect(host.querySelector('.source-full-details')?.textContent).toContain('A price of $3000');
  expect(host.querySelector('.source-card-title a[href*="text="]')).not.toBeNull();
  expect(host.querySelector('.source-full-details button')?.textContent).toContain('复制引用');
  host.innerHTML=renderToStaticMarkup(<VerificationAnswer message={message} history/>);
  expect(host.querySelector('.compact-sources > .verification-record')?.textContent).toContain(message.verification!.summary);
  expect(host.querySelector('.compact-sources > .verification-record')?.tagName).toBe('DIV');
});
it("does not promote existing sources or successful-looking text when search is unknown, provisional, interrupted, or failed", () => {
  expect(verificationBrief({...message,search:undefined}).complete).toBe(false);
  expect(verificationBrief({...message,completion:'provisional'}).conclusion).toContain('正在查找');
  expect(verificationBrief({...message,completion:'interrupted'}).complete).toBe(false);
  expect(verificationBrief(message,'连接失败').complete).toBe(false);
  expect(verificationBrief({...message,search:undefined}).limitation).not.toContain('未找到充分依据');
});
it("does not judge truth or duplicate retry instructions and never executes unsafe source links", () => {
  const old={...message,verification:{...message.verification!,readingAdvice:'保留原句的不确定性。'}};
  expect(verificationBrief(old).limitation).toContain('2024年渠道报价');
  expect(verificationBrief({...old, search:undefined}).conclusion).toContain('无法确认是否执行了搜索');
  expect(verificationBrief({...old,sources:[]}).conclusion).not.toContain('暂未找到');
  expect(verificationBrief({...old,sources:[{...old.sources![0],retrievalStatus:'not-read'}]}).complete).toBe(true);
  const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(<VerificationAnswer message={{...message,sources:[{...message.sources![0],url:'javascript:alert(1)',retrievalStatus:'not-read'}]}}/>);
  expect(host.querySelector('a')).toBeNull();expect(host.querySelector('.source-full-details button')).toBeNull();
});

it.each([false, true])("shows interruption and retains partial sources (sources=%s)", hasSources => {
  const interrupted = interruptMessage({ ...message, completion: "provisional", sources: hasSources ? message.sources : [] });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<VerificationAnswer message={interrupted} failure="连接断开" />);
  expect(host.querySelector('.verification-conclusion')?.textContent).toBe(`本次查找已中断${hasSources ? '，已收到的参考资料已保留' : ''}。`);
  expect(host.querySelectorAll('.source-evidence-card')).toHaveLength(hasSources ? 1 : 0);
  expect(host.textContent).not.toContain('暂未找到');
  expect(host.textContent).not.toContain('本轮没有');
  expect(verificationBrief(interrupted).conclusion).toContain('已中断'); // restored/history messages lack lastError
});

it("prioritizes failure over provisional or successful-looking content", () => {
  expect(verificationBrief({ ...message, completion: 'provisional' }, '服务不可用').conclusion).toBe('本次查找失败，已收到的参考资料已保留。');
  expect(verificationBrief(message, '服务不可用').complete).toBe(false);
  expect(verificationBrief({ ...message, search: { status: 'failed', completedSearches: 0, failedSearches: 1 } }).conclusion).toContain('本次查找失败');
});

it("has one empty state after a completed search and no premature empty state while loading", () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<VerificationAnswer message={{ ...message, sources: [] }} />);
  expect(host.querySelector('.verification-conclusion')?.textContent).not.toContain('暂未找到');
  expect(host.querySelector('.source-section')).toBeNull();
  host.innerHTML = renderToStaticMarkup(<VerificationAnswer message={{ ...message, sources: [], completion: 'provisional' }} />);
  expect(host.querySelector('.verification-conclusion')?.textContent).toBe('正在查找来源，当前内容尚待核对。');
  expect(host.textContent).not.toMatch(/没有|未找到/);
});

 it.each([
  ['supported','原报告给出20%的预测增长率。','适用于2025—2030年，不是实测增速。'],
  ['insufficient','本次没有定位到对应出处。','在本次搜索范围内无法确认，不代表原文错误。'],
 ] as const)('makes the reading limitation visible for %s without a task to complete',(verdict,summary,reason)=>{
  const m={...message,sources:message.sources!.map(s=>({...s,applicability:'direct' as const,origin:'original' as const,reliability:'strong' as const,reliabilityReasons:['原报告统计范围明确']})),verification:{...message.verification!,verdict,summary,reason,claims:[{text:'增长',verdict:verdict==='supported'?'supported' as const:'partial' as const,sourceIds:['s1']}],readingAdvice:'请继续查找，点击再找一下'}};
  const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(<VerificationAnswer message={m}/>);
  expect(host.querySelector('.verification-brief')?.textContent).toContain(summary);
  expect(host.querySelector('.verification-brief')?.textContent).toContain(reason);
  expect(host.querySelector('.verification-brief')?.textContent).not.toMatch(/请继续|再找一下|未完成/);
 });
 it('keeps old unstructured answers available without inventing search results',()=>{
  const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(<VerificationAnswer message={{...message,verification:undefined,search:undefined,content:'历史正文'}}/>);
  expect(host.textContent).toContain('无法确认是否执行了搜索');
  expect(host.querySelector('details')?.textContent).toContain('历史正文');
  expect(host.querySelector('details')?.hasAttribute('open')).toBe(false);
 });

it('rebuilds an affirmative partial legacy summary when its cited body cannot be checked',()=>{
 const m={...message,verification:{...message.verification!,summary:'报告已经确认原文数字',reason:'完全可信'},sources:[{...message.sources![0],retrievalStatus:'unavailable' as const}]};
 const brief=verificationBrief(m);expect(brief.conclusion+brief.limitation).not.toMatch(/已经确认|完全可信/);expect(brief.limitation).toContain('引用正文尚未核对');
});

it('does not promote unsupported affirmative text from a complete legacy record',()=>{
 const brief=verificationBrief({...message,verification:{...message.verification!,verdict:'supported',claims:[],summary:'所有数字已经证实'}});
 expect(brief.conclusion).not.toContain('已经证实');expect(brief.limitation).toContain('2024年渠道报价');
});

it('does not turn a matched secondary quote into an affirmative partial conclusion',()=>{
 const m={...message,verification:{...message.verification!,summary:'报告已经确认原文数字',reason:'完全可信',readingAdvice:'可直接引用'},sources:[{...message.sources![0],origin:'secondary' as const,relation:'related' as const}]};
 const brief=verificationBrief(m);
 expect(brief.conclusion+brief.limitation).not.toMatch(/已经确认|完全可信|可直接引用/);
 expect(brief.limitation).toContain('2024年渠道报价');expect(brief.limitation).toContain('不代表当前统一售价');expect(brief.limitation).toContain('转述资料');
});
it('retains a useful scope restriction stored only in legacy reading advice',()=>{
 const m={...message,verification:{...message.verification!,verdict:'insufficient' as const,reason:'缺少完整出处。',readingAdvice:'仅适用于2024年的预测，不代表实测。请继续查找。'}};
 const brief=verificationBrief(m);expect(brief.limitation).toContain('仅适用于2024年的预测，不代表实测');expect(brief.limitation).not.toContain('继续查找');
});
