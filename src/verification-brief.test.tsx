import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { VerificationAnswer, verificationBrief } from "./VerificationAnswer";
import type { ThreadMessage } from "./types";
import { interruptMessage } from "./lib/inquiry-stream";

const message: ThreadMessage = {
  id: "m", role: "assistant", createdAt: "2026", content: "原回答", operation: "verify", completion: "complete", mode: "live",
  search: { status: "executed", completedSearches: 1, failedSearches: 0 },
  verification: { verdict: "partial", summary: "有报道提到约3000美元，但不是统一售价", reason: "报道对应特定渠道", readingAdvice: "仅可用于2024年特定渠道，不代表当前售价。", claims: [], round: 2, scope: "expanded", completion: "complete" },
  sources: [{id:"s1",title:"完整报道标题",publisher:"示例媒体",publishedAt:"2024-02-26",url:"https://example.org/report",domain:"example.org",scope:"2024年渠道报价",differences:["不代表当前统一售价。"],excerpt:"A price of $3000",excerptKind:"quote",retrievalStatus:"matched",locatable:true,relation:"supports"}],
};

it("shows source cards directly while per-source details start closed", () => {
  const host=document.createElement("div"); host.innerHTML=renderToStaticMarkup(<VerificationAnswer message={message}/>);
  expect(host.querySelector('.verification-brief')?.textContent).toContain("找到了相关来源");
  expect(host.querySelector('.verification-limitation')).toBeNull();
  expect(host.querySelector('.source-assessment')?.closest('details.verification-record')?.hasAttribute('open')).toBe(false);
  expect(host.querySelector('.verification-brief')?.textContent).not.toMatch(/第 2 轮|关键理由|已执行搜索/);
  expect(host.querySelectorAll('details[open]')).toHaveLength(0);
  expect(host.querySelector('.compact-sources > summary')).toBeNull();
  expect(host.textContent).not.toContain('历史查证记录');
  expect(host.querySelector('.compact-sources > .verification-record')).toBeNull();
  expect(host.querySelector('.source-evidence-card')?.closest('details')).toBeNull();
  expect(host.querySelector('.source-evidence-heading')?.textContent).toContain('示例媒体 · 2024-02-26');
  expect(host.querySelector('.source-brief')?.textContent).toBe('完整报道标题');
  expect(host.querySelector('.source-full-details')?.textContent).toContain('A price of $3000');
  expect(host.querySelector('.source-full-details a[href*="text="]')).not.toBeNull();
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
  expect(verificationBrief(old).limitation).toBe('');
  expect(verificationBrief({...old, search:undefined}).conclusion).toBe('找到了相关来源');
  expect(verificationBrief({...old,sources:[]}).conclusion).toBe('暂未找到可查看的来源');
  expect(verificationBrief({...old,sources:[{...old.sources![0],retrievalStatus:'not-read'}]}).conclusion).toBe('找到了可能相关的来源');
  const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(<VerificationAnswer message={{...message,sources:[{...message.sources![0],url:'javascript:alert(1)',retrievalStatus:'not-read'}]}}/>);
  expect(host.querySelector('a')).toBeNull();expect(host.querySelector('.source-full-details button')).toBeNull();
});

it.each([false, true])("shows interruption and retains partial sources (sources=%s)", hasSources => {
  const interrupted = interruptMessage({ ...message, completion: "provisional", sources: hasSources ? message.sources : [] });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<VerificationAnswer message={interrupted} failure="连接断开" />);
  expect(host.querySelector('.verification-conclusion')?.textContent).toBe(`本次查找已中断${hasSources ? '，已找到的来源已保留' : ''}`);
  expect(host.querySelectorAll('.source-evidence-card')).toHaveLength(hasSources ? 1 : 0);
  expect(host.textContent).not.toContain('暂未找到');
  expect(host.textContent).not.toContain('本轮没有');
  expect(verificationBrief(interrupted).conclusion).toContain('已中断'); // restored/history messages lack lastError
});

it("prioritizes failure over provisional or successful-looking content", () => {
  expect(verificationBrief({ ...message, completion: 'provisional' }, '服务不可用').conclusion).toBe('本次查找未完成，已找到的来源已保留');
  expect(verificationBrief(message, '服务不可用').complete).toBe(false);
  expect(verificationBrief({ ...message, search: { status: 'failed', completedSearches: 0, failedSearches: 1 } }).conclusion).toContain('本次查找未完成');
});

it("has one empty state after a completed search and no premature empty state while loading", () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<VerificationAnswer message={{ ...message, sources: [] }} />);
  expect(host.querySelector('.verification-conclusion')?.textContent).toBe('暂未找到可查看的来源');
  expect(host.querySelector('.source-section')).toBeNull();
  host.innerHTML = renderToStaticMarkup(<VerificationAnswer message={{ ...message, sources: [], completion: 'provisional' }} />);
  expect(host.querySelector('.verification-conclusion')?.textContent).toBe('正在查找相关来源');
  expect(host.textContent).not.toMatch(/没有|未找到/);
});
