import { REFINEMENTS } from "./lib/learning";
import { resetTestLibrary, testWorkspace, testLibraryRequest } from "./test-support/library";
vi.mock("./lib/library-client", async () => ({ libraryRequest: (await import("./test-support/library")).testLibraryRequest }));
vi.mock('./PdfReader',async()=>{const {useEffect}=await import('react');return {default:(props:{onReady?:()=>void})=>{useEffect(()=>props.onReady?.(),[]);return <div className="pdf-reader" data-page="1" data-zoom="0"/>;}};});
import { TEST_MODELS } from "../server/test-support/model-catalog";
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { createInitialWorkspace } from './sample';
import { renderMarkdown } from './lib/markdown';
import { STORAGE_KEY } from './lib/storage';
import type { InquiryEvent, InquiryRequest, Workspace } from './types';
import { inquiryCategoryStatus } from './lib/inquiry-tabs';
const stream=vi.hoisted(()=>vi.fn());
vi.mock('./lib/inquiry-stream',async original=>({...await original<typeof import('./lib/inquiry-stream')>(),readInquiryStream:stream}));
let root:Root,host:HTMLDivElement,w:Workspace;
const click=async(selector:string)=>{await act(async()=>{(host.querySelector(selector) as HTMLElement).click();});};
const choose=async(selector:string,value:string)=>{await act(async()=>{const el=host.querySelector(selector) as HTMLSelectElement;el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});};
beforeEach(async()=>{
 resetTestLibrary();
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 HTMLElement.prototype.scrollIntoView=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({models:TEST_MODELS,providers:[{id:'codex',name:'Codex',availability:'connected',supportsWebSearch:true}],defaultProviderId:'codex'})})));
 w=createInitialWorkspace();const html=document.createElement('div');html.innerHTML=renderMarkdown(w.document.markdown!).html;
 const p=[...html.querySelectorAll('p')].find(p=>p.textContent?.includes('CAGR'))!;const text=p.textContent!;const start=text.indexOf('CAGR');
 w.inquiries=[{id:'explain',intent:'explain',question:'解释CAGR',anchor:{documentId:w.document.id,blockId:p.dataset.blockId!,headingPath:[],quote:'CAGR',prefix:text.slice(0,start),suffix:text.slice(start+4),start,end:start+4,matchStatus:'matched'},status:'ready',messages:[{id:'old',role:'assistant',content:'已有解释',createdAt:'2026',mode:'live',providerId:'codex',completion:'complete'}],understanding:'',createdAt:'2026',updatedAt:'2026'}];
 w.activeInquiryId='explain';w.activeProviderId='codex';
 host=document.createElement('div');document.body.append(host);root=createRoot(host);stream.mockReset();
});
async function mount(){localStorage.setItem(STORAGE_KEY,JSON.stringify(w));await act(async()=>root.render(<App/>));}
async function mountLegacyRetry(){
 w.inquiries[0].lastError='历史固定解释未完成';
 w.inquiries[0].messages.push({id:'legacy-question',role:'user',content:REFINEMENTS.simplify.prompt,createdAt:'2026'}, {id:'legacy-failure',role:'assistant',content:'',createdAt:'2026',completion:'interrupted',operation:'explain',explanationMode:'auto'});
 const entry=await testLibraryRequest('/entries',{workspace:w,creationKey:'legacy-retry'}) as {id:string};
 await testLibraryRequest(`/entries/${entry.id}/activate`,{});
 await mount();
}

afterEach(async()=>{await act(async()=>root.unmount());host.remove();localStorage.removeItem(STORAGE_KEY);vi.unstubAllGlobals();});
it('categories list the whole document and highlights open their own results without generating',async()=>{
 const base=w.inquiries[0];
 w.inquiries.push({...base,id:'mini',intent:'entity',anchor:{...base.anchor,quote:'MiniMax',start:100,end:107},messages:[{id:'m',role:'assistant',content:'MiniMax介绍',createdAt:'2026'}]});
 w.inquiries.push({...base,id:'other',intent:'entity',anchor:{...base.anchor,quote:'Replika',start:200,end:207}});
 await mount();await click('#intent-tab-explain');
 expect(host.querySelector('.category-items')?.textContent).toContain('MiniMax');expect(host.querySelector('.category-items')?.textContent).toContain('Replika');
 expect(host.querySelector('.answer-markdown')).toBeNull();await click('[data-inquiry-id=mini]');
 expect(host.querySelector('.answer-markdown')?.textContent).toContain('MiniMax介绍');
 await click('#intent-tab-explain');expect(host.querySelector('.category-items')?.textContent).toContain('CAGR');expect(host.querySelector('.category-items')?.textContent).toContain('MiniMax');
 await click('.category-open');expect(host.querySelector('.answer-markdown')?.textContent).toContain('已有解释');
 await click('#intent-tab-verify');expect(host.querySelector('.category-items')?.textContent).toContain('还没有');expect(host.querySelector('.empty-intent button')).toBeNull();
 expect(stream).not.toHaveBeenCalled();expect(testWorkspace().activeTab).toEqual({intent:'verify'});
});
it('same anchor exposes only existing needs and request completion never steals category focus',async()=>{
 const base=w.inquiries[0];w.inquiries.push({...base,id:'entity',intent:'entity'});
 let emit!:(event:InquiryEvent)=>void,finish!:()=>void;
 stream.mockImplementation((_r:InquiryRequest,cb:any)=>{emit=cb;return new Promise<void>(r=>finish=r);});
 await mount();expect(host.querySelector('.anchor-requests')?.textContent).toContain('解释');expect(host.querySelector('.anchor-requests')?.textContent).not.toContain('来源');
 await choose('select[aria-label="历史记录"]','entity');expect(host.querySelector('[role=tab][aria-selected=true]')?.id).toBe('intent-tab-explain');
 await click('.detail-introduction-action');const request=stream.mock.calls[0][0];await click('#intent-tab-explain');
 await act(async()=>{emit({type:'complete',requestId:request.requestId,sequence:1,response:{answer:'完成介绍',mode:'live',providerId:'codex',providerName:'Codex',sources:[],evidenceStatus:'not-applicable'}});finish();});
 expect(host.querySelector('[role=tab][aria-selected=true]')?.id).toBe('intent-tab-explain');expect(host.querySelector('.answer-markdown')).toBeNull();expect(stream).toHaveBeenCalledTimes(1);
});
it('failure-only regeneration retries the failed configuration and retains history',async()=>{
 w.inquiries[0].lastError='连接失败';w.inquiries[0].messages.push({id:'failure',role:'assistant',content:'',createdAt:'2026',completion:'interrupted',operation:'explain',modelConfig:{model:'gpt-5.6-luna',reasoningEffort:'max'}});
 w.inquiries[0].messages.splice(1,0,{id:'question',role:'user',content:'解释CAGR',createdAt:'2026'});
 stream.mockRejectedValue(new Error('用于测试错误恢复'));
 await mount();await choose('select[aria-label="当前用途的模型"]','gpt-5.6-sol');await choose('select[aria-label="当前用途的推理强度"]','low');
 await click('.regenerate-action');expect(stream.mock.calls[0][0].modelConfig).toEqual({model:'gpt-5.6-luna',reasoningEffort:'max'});
 await click('.regenerate-action');expect(stream.mock.calls[1][0].modelConfig).toEqual({model:'gpt-5.6-luna',reasoningEffort:'max'});
 expect(host.textContent).toContain('已有解释');
});
it('legacy why and duplicate intent histories remain accessible',async()=>{
 w.inquiries.push({...w.inquiries[0],id:'older',updatedAt:'2025',messages:[{id:'old2',role:'assistant',content:'更早的解释',createdAt:'2025'}]});
 w.inquiries.push({...w.inquiries[0],id:'why',intent:'why',messages:[{id:'why1',role:'assistant',content:'旧为什么回答',createdAt:'2026'}]});
 w.activeInquiryId='why';await mount();expect(host.querySelector('.return-to-list')?.textContent).toBe('返回');expect(host.textContent).toContain('旧为什么回答');
 await click('#intent-tab-explain');await click('.category-open');await choose('select[aria-label="历史记录"]','older');expect(host.textContent).toContain('更早的解释');expect(stream).not.toHaveBeenCalled();
});
it('uses all catalog models, changes incompatible effort to official default, and preserves other intent preferences',async()=>{
 await mount();await choose('select[aria-label="当前用途的模型"]','gpt-6-astra');await choose('select[aria-label="当前用途的推理强度"]','ultra');
 await choose('select[aria-label="当前用途的模型"]','gpt-5.5');
 const effort=host.querySelector('select[aria-label="当前用途的推理强度"]') as HTMLSelectElement;
 expect(effort.value).toBe('medium');expect([...effort.options].map(o=>o.value)).toEqual(['low','medium','high','xhigh']);
 await choose('select[aria-label="设置用途"]','ask');expect((host.querySelector('select[aria-label="当前用途的模型"]') as HTMLSelectElement).value).toBe('gpt-6.1-sol');expect(stream).not.toHaveBeenCalled();
});
it('preserves unavailable SOL 6.1 defaults, reports missing catalog and refreshes without generating',async()=>{
 w.modelDefaultsVersion=3;
 let failed=false;
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>({ok:!failed,json:async()=>input.includes('/models')?failed?{error:'连接中断'}:{models:TEST_MODELS.filter(m=>m.model!=='gpt-6.1-sol')}:{providers:[{id:'codex',name:'Codex',availability:'connected',supportsWebSearch:true}],defaultProviderId:'codex'}})));
 await mount();expect(host.querySelector('[role=alert]')).toBeNull();expect((host.querySelector('.question-toggle') as HTMLButtonElement).disabled).toBe(true);expect(host.textContent).toContain('不会自动换模型');
 expect((host.querySelector('select[aria-label="当前用途的模型"]') as HTMLSelectElement).value).toBe('gpt-6.1-sol');
 expect(testWorkspace().modelPreferences!.explain).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'});
 failed=true;await act(async()=>{const details=host.querySelector('.model-settings') as HTMLDetailsElement;details.open=true;details.dispatchEvent(new Event('toggle'));});expect(host.querySelector('[role=alert]')?.textContent).toContain('连接中断');expect((host.querySelector('select[aria-label="当前用途的模型"]') as HTMLSelectElement).disabled).toBe(true);
 failed=false;await click('.model-controls [role=alert] button');expect(host.querySelector('.model-controls [role=alert]')).toBeNull();expect(stream).not.toHaveBeenCalled();
});
it('restores legacy empty anchor tabs as category pages without creating requests',async()=>{
 w.inquiries[0].intent='verify';w.activeTab={anchorInquiryId:w.inquiries[0].id,intent:'explain'};
 await mount();expect(host.querySelector('.category-items')?.textContent).toContain('还没有解释一下');expect(host.querySelector('.empty-intent button')).toBeNull();expect(stream).not.toHaveBeenCalled();
});
it('restores an independent category list after reload',async()=>{
 w.activeInquiryId=null;w.activeTab={intent:'entity'};await mount();
 expect(host.querySelector('[role=tab][aria-selected=true]')?.id).toBe('intent-tab-explain');expect(host.querySelector('.answer-markdown')).toBeNull();expect(stream).not.toHaveBeenCalled();
});
it('replacing a document preserves preferences, clears search and aborts old requests',async()=>{
 let signal:AbortSignal|undefined;
 stream.mockImplementation((_request:any,_cb:any,s:AbortSignal)=>{signal=s;return new Promise<void>((_resolve,reject)=>s.addEventListener('abort',()=>reject(new Error('aborted'))));});
 HTMLElement.prototype.scrollTo=vi.fn();vi.spyOn(window,'confirm').mockReturnValue(true);
 w.modelPreferences={explain:{model:'gpt-5.5',reasoningEffort:'high'}};
 await mountLegacyRetry();await click('.regenerate-action');
 const file=new File(['# 新文档\n新正文'],'next.md',{type:'text/markdown'});Object.defineProperty(file,'text',{value:async()=>'# 新文档\n新正文'});
 await act(async()=>{const input=host.querySelector('input[type=file]') as HTMLInputElement;Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(signal?.aborted).toBe(true);
 const stored=testWorkspace();expect(stored.document.filename).toBe('next.md');expect(stored.inquiries).toEqual([]);expect(stored.modelPreferences!.explain).toEqual({model:'gpt-5.5',reasoningEffort:'high'});expect(host.textContent).toContain('新正文');expect(stream).toHaveBeenCalledTimes(1);
});
it('stopping a request preserves history, aborts transport and ignores late completion',async()=>{
 let emit!:(event:InquiryEvent)=>void,signal!:AbortSignal,finish!:()=>void;
 stream.mockImplementation((_r:any,cb:any,s:AbortSignal)=>{emit=cb;signal=s;return new Promise<void>(r=>finish=r);});
 await mountLegacyRetry();await click('.regenerate-action');const request=stream.mock.calls[0][0];
 const stop=[...host.querySelectorAll<HTMLButtonElement>('button')].find(e=>e.textContent==='停止本次请求')!;
 await act(async()=>stop.click());expect(signal.aborted).toBe(true);expect(host.textContent).toContain('已停止本次请求');
 await act(async()=>{emit({requestId:request.requestId,sequence:9,type:'complete',response:{answer:'迟到结果',sources:[],providerId:'codex',providerName:'Codex',mode:'live',evidenceStatus:'not-applicable'}});finish();});
 expect(host.textContent).not.toContain('迟到结果');expect(host.textContent).toContain('已有解释');
});
it('followups after failed attempts omit empty historical messages and retry preserves that boundary',async()=>{
 w.inquiries[0].messages.unshift({id:'empty',role:'assistant',content:'',completion:'interrupted',createdAt:'2025'});
 stream.mockRejectedValue(new Error('测试失败'));
 await mountLegacyRetry();await click('.regenerate-action');
 expect(stream.mock.calls[0][0].history.every((m:any)=>m.content.trim())).toBe(true);
 await click('.regenerate-action');expect(stream.mock.calls[1][0].history.every((m:any)=>m.content.trim())).toBe(true);
});
it('migrates old workspace defaults once to GPT-6 without rewriting historical model snapshots',async()=>{
 w.modelDefaultsVersion=2;w.modelPreferences={explain:{model:'gpt-5.6-luna',reasoningEffort:'max'},entity:{model:'gpt-5.6-sol',reasoningEffort:'medium'},verify:{model:'gpt-5.5',reasoningEffort:'high'}};
 w.inquiries[0].messages[0].modelConfig={model:'gpt-5.6-luna',reasoningEffort:'max'};
 await mount();const saved=testWorkspace();
 expect(saved.modelDefaultsVersion).toBe(4);expect(saved.modelPreferences!.explain).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'});expect(saved.modelPreferences!.entity).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'});expect(saved.modelPreferences!.verify).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'}); for (const intent of ['ask','why'] as const) expect(saved.modelPreferences![intent]).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'});
 expect(saved.inquiries[0].messages[0].modelConfig).toEqual({model:'gpt-5.6-luna',reasoningEffort:'max'});expect(stream).not.toHaveBeenCalled();
});
it('renders deltas before completion, keeps them provisional and preserves partial text on stop',async()=>{
 let emit!:(event:InquiryEvent)=>void;
 stream.mockImplementation((_r:InquiryRequest,cb:any,signal:AbortSignal)=>{emit=cb;return new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('中断'))));});
 await mountLegacyRetry();await click('.regenerate-action');const request=stream.mock.calls[0][0];
 await act(async()=>{emit({type:'answer-delta',delta:'这是',requestId:request.requestId,sequence:1});emit({type:'answer-delta',delta:'逐步解释',requestId:request.requestId,sequence:2});});
 expect(host.querySelectorAll('.answer-markdown')[0].textContent?.trim()).toBe('这是逐步解释');expect(host.textContent).toContain('正在生成，内容尚未完成');
 const saved=testWorkspace();expect(saved.inquiries[0].messages.at(-1)?.completion).toBe('provisional');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes('停止'))!.click());
 expect(host.textContent).toContain('这是逐步解释');expect(testWorkspace().inquiries[0].messages.at(-1)?.completion).toBe('interrupted');
 await act(async()=>emit({type:'answer-delta',delta:'迟到内容',requestId:request.requestId,sequence:3}));expect(host.textContent).not.toContain('迟到内容');
});
it('shows model controls inside the closed provider menu and exposes secondary actions alongside completion',async()=>{
 await mount();expect((host.querySelector('.model-settings') as HTMLDetailsElement).open).toBe(true);expect((host.querySelector('.provider-shell') as HTMLElement).hidden).toBe(true);expect(host.querySelector('.more-actions')).toBeNull();expect(host.querySelector('.compact-actions')?.textContent).toContain('还是不懂？');
 expect(host.querySelector('.anchor-card')).toBeNull();expect(host.querySelector('.user-message')).toBeNull();expect(host.querySelector('.inquiry-head')).toBeNull();expect((host.querySelector('.category-items') as HTMLElement).hidden).toBe(true);
 await click('.result-navigation button');expect((host.querySelector('.category-items') as HTMLElement).hidden).toBe(false);expect(host.querySelector('.answer-markdown')).toBeNull();expect(stream).not.toHaveBeenCalled();
});
it.each([[99, '(99)'], [100, '(99+)']] as const)('renders single-line tab icons and count %s with zero hidden',async(count,label)=>{
 const base=w.inquiries[0];w.inquiries=Array.from({length:count},(_,i)=>({...base,id:'i'+i}));w.activeInquiryId='i0';await mount();
 expect(host.querySelector('#intent-tab-explain')?.textContent).toBe('解释一下'+label);expect(host.querySelector('#intent-tab-verify')?.textContent).toBe('查找来源');
 expect(host.querySelectorAll('.inquiry-tabs button > svg').length).toBe(3);expect(host.querySelector('.inquiry-tabs small')).toBeNull();
});

it.each(['explain','why','verify'] as const)('uses a noninteractive prompt and explicitly submitted question for %s',async intent=>{
 w.inquiries[0].intent=intent;
 stream.mockRejectedValue(new Error('测试请求失败'));
 await mount();const original=structuredClone(testWorkspace().inquiries[0]);
 const prompt=host.querySelector<HTMLElement>('.question-prompt')!;
 expect(prompt.tagName).toBe('SPAN');expect(prompt.textContent).toBe('还是不懂？');
 expect(prompt.hasAttribute('tabindex')).toBe(false);expect(prompt.hasAttribute('role')).toBe(false);
 expect(host.querySelector('.explain-again-action')).toBeNull();
 await click('.question-prompt');expect(stream).not.toHaveBeenCalled();expect(host.querySelector('textarea')).toBeNull();
 await click('.question-toggle');expect(stream).not.toHaveBeenCalled();
 expect(host.querySelector('.question-prompt')).toBeNull();
 expect(host.querySelector('textarea')?.getAttribute('placeholder')).toBeNull();
 await typeQuestion('能举个例子吗？');
 await act(async()=>host.querySelector<HTMLTextAreaElement>('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(stream).not.toHaveBeenCalled();await click('.question-toggle');
 expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('能举个例子吗？');
 await click('.question-composer [type=submit]');
 expect(stream).toHaveBeenCalledTimes(1);expect(stream.mock.calls[0][0]).toMatchObject({intent:'ask',question:'能举个例子吗？'});
 expect(testWorkspace().inquiries).toHaveLength(2);expect(testWorkspace().inquiries[0]).toEqual(original);
 expect(testWorkspace().inquiries[1].anchor).toEqual(original.anchor);
 expect(stream.mock.calls[0][0].history).toContainEqual({role:'assistant',content:'已有解释'});
 expect(host.querySelector('#intent-tab-ask')?.getAttribute('aria-selected')).toBe('true');
});

it('keeps legacy distilled records readable and complete without distillation controls',async()=>{
 w.inquiries[0].status='distilled';w.inquiries[0].messages[0].evidenceStatus='unsupported';await mount();
 const saved=testWorkspace().inquiries[0];
 expect(saved.status).toBe('distilled');expect(saved.messages[0].evidenceStatus).toBe('unsupported');expect(saved.messages).toHaveLength(1);
 expect(host.querySelector('.distill-action')).toBeNull();expect(host.querySelector('.undo-popover')).toBeNull();
 expect(host.querySelector('.compact-actions .primary-action')).toBeNull();
 expect((host.querySelector('.question-toggle') as HTMLButtonElement).disabled).toBe(false);expect(stream).not.toHaveBeenCalled();
});

it.each(['explain','verify','entity'] as const)('only exposes regeneration after failure for %s and hides it during retry and after success',async intent=>{
 w.inquiries[0].intent=intent;w.inquiries[0].messages[0].search={status:'not-executed',completedSearches:0,failedSearches:0};
 let emit!:(event:InquiryEvent)=>void,finish!:()=>void;
 stream.mockImplementation((_r:InquiryRequest,cb:any)=>{emit=cb;return new Promise<void>(r=>finish=r);});
 await mount();expect(host.querySelector('.regenerate-action')).toBeNull();
 await act(async()=>root.unmount());root=createRoot(host);
 w.inquiries[0].lastError='模型连接失败';w.inquiries[0].messages.push({id:'failed',role:'assistant',content:'',createdAt:'2026',completion:'interrupted',operation:intent,scope:'expanded',round:2});
 await mount();expect(host.querySelectorAll('.regenerate-action')).toHaveLength(intent==='verify'?0:1);expect(host.querySelector('.error-card button')).toBeNull();
 await click(intent==='verify'?'.verify-again-action':'.regenerate-action');const request=stream.mock.calls[0][0];expect(request.intent).toBe(intent);expect(request.operation).toBe(intent);expect(request.scope).toBe('expanded');expect(request.round).toBe(2);
 expect(host.querySelector('.regenerate-action')).toBeNull();
 await act(async()=>{emit({type:'complete',requestId:request.requestId,sequence:1,response:{answer:'恢复成功',mode:'live',providerId:'codex',providerName:'Codex',sources:[],evidenceStatus:'not-applicable'}});finish();});
 expect(host.querySelector('.regenerate-action')).toBeNull();expect(host.textContent).toContain('恢复成功');
});

it('detailed introduction uses entity preferences and preserves its instruction and history on retry',async()=>{
 w.inquiries[0].intent='entity';w.modelPreferences={explain:{model:'gpt-5.5',reasoningEffort:'high'},entity:{model:'gpt-5.6-sol',reasoningEffort:'medium'}};
 stream.mockRejectedValue(new Error('受控介绍失败'));await mount();
 expect(host.querySelector('.compact-actions')?.textContent).toContain('详细介绍');expect(host.querySelector('.explain-again-action')).toBeNull();expect(host.querySelector('.compact-actions')?.textContent).not.toContain('继续查证');
 await click('.detail-introduction-action');const first=stream.mock.calls[0][0];
 expect(first.operation).toBe('entity');expect(first.modelConfig).toEqual({model:'gpt-5.6-sol',reasoningEffort:'medium'});
 expect(first.question).toContain('不要重复');expect(first.question).toContain('具体场景或例子');expect(first.question).not.toContain('三到五句');expect(first.history).toContainEqual({role:'assistant',content:'已有解释'});
 await click('.regenerate-action');const retry=stream.mock.calls[1][0];expect(retry.operation).toBe('entity');expect(retry.question).toBe(first.question);expect(retry.modelConfig).toEqual(first.modelConfig);
 expect(host.querySelector('.answer-history')?.textContent).toContain('已有解释');expect(testWorkspace().inquiries).toHaveLength(1);
});
it('verification offers only questions, hides old answers, and keeps existing data',async()=>{
 w.inquiries[0].intent='verify';
 w.inquiries[0].messages[0].verification={verdict:'partial',summary:'只支持一部分',reason:'缺少同年份资料',readingAdvice:'保留限制',claims:[],round:3,scope:'expanded',completion:'complete'};
 w.inquiries[0].messages.unshift({...w.inquiries[0].messages[0],id:'older-verify',content:'旧查证结果'});
 await mount();
 expect([...host.querySelectorAll('.compact-actions button')].map(b=>b.textContent)).toEqual(['问一问']);
 expect(host.querySelector('.question-prompt')?.textContent).toBe('还是不懂？');
 expect(host.querySelector('.answer-history')).toBeNull();
 expect(testWorkspace().inquiries[0].messages).toHaveLength(2);
 expect(stream).not.toHaveBeenCalled();
});
it('verification retry retains legacy expanded scope and evidence without exposing history',async()=>{
 w.inquiries[0].intent='verify';
 w.inquiries[0].messages[0].verification={verdict:'partial',summary:'部分来源',reason:'缺口',readingAdvice:'',claims:[],round:3,scope:'expanded',completion:'complete'};
 w.inquiries[0].lastError='受控失败';
 w.inquiries[0].messages.push({id:'failed',role:'assistant',content:'',createdAt:'2026',operation:'verify',completion:'interrupted',scope:'expanded',round:4,parentMessageId:'old'});
 stream.mockRejectedValue(new Error('受控失败'));await mount();
 expect(host.querySelector('.verify-again-action')?.textContent).toBe('重试');
 await click('.verify-again-action');const retry=stream.mock.calls[0][0];
 expect(retry).toMatchObject({intent:'verify',operation:'verify',scope:'expanded',round:4,parentMessageId:'old'});
 expect(retry.previous.verification.reason).toBe('缺口');
 expect(host.querySelector('.answer-history')).toBeNull();
 expect(testWorkspace().inquiries[0].messages[0].verification?.round).toBe(3);
});
it('moves legacy DeepSeek selection to Codex, preserving answers and using Codex for new requests',async()=>{
 w.activeProviderId='deepseek';w.modelDefaultsVersion=4;
 w.modelPreferences={explain:{model:'gpt-5.5',reasoningEffort:'high'}};
 w.inquiries[0].messages[0].providerId='deepseek';
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({models:TEST_MODELS,providers:[{id:'codex',name:'Codex',availability:'connected',supportsWebSearch:true},{id:'deepseek',name:'DeepSeek',availability:'connected',supportsWebSearch:false}],defaultProviderId:'deepseek'})})));
 stream.mockRejectedValue(new Error('受控请求失败'));
 await mountLegacyRetry();await click('.provider-trigger');
 expect(host.querySelector('.provider-popover')?.textContent).not.toMatch(/DeepSeek|API Key|本地实验/);
 expect(host.querySelectorAll('.provider-option')).toHaveLength(1);
 expect(host.querySelector('#deepseek-key')).toBeNull();
 expect(testWorkspace().activeProviderId).toBe('codex');
 expect(testWorkspace().modelPreferences!.explain).toEqual({model:'gpt-5.5',reasoningEffort:'high'});
 expect(testWorkspace().inquiries[0].messages[0].providerId).toBe('deepseek');
 expect(host.textContent).toContain('已有解释');expect(stream).not.toHaveBeenCalled();
 await click('.regenerate-action');expect(stream.mock.calls[0][0]).toMatchObject({providerId:'codex',modelConfig:{model:'gpt-5.5',reasoningEffort:'high'}});
});

it.each(['incomplete','interrupted','failed'] as const)('leaving unfinished sources preserves state and retry: %s',async state=>{
 const inquiry=w.inquiries[0];inquiry.intent='verify';inquiry.status='needs-verification';
 const message=inquiry.messages[0];message.verification={verdict:'incomplete',summary:'未完成',reason:'未确认搜索',readingAdvice:'保留限制',claims:[],round:1,scope:'initial',completion:state==='interrupted'?'interrupted':'complete'};
 if(state==='interrupted')message.completion='interrupted';
 if(state==='failed')inquiry.lastError='受控失败';
 await mount();const before=structuredClone(testWorkspace().inquiries[0]);
 expect(host.querySelector('.primary-action')).toBeNull();
 await click('.return-to-list');
 expect(testWorkspace().inquiries[0]).toEqual(before);
 expect(host.querySelector('.category-items')?.textContent).toContain('未完成');
 await click('.category-open');expect(host.querySelector('.primary-action')).toBeNull();
 expect(stream).not.toHaveBeenCalled();
 if(state==='incomplete'){expect(host.querySelector('.verify-again-action')).toBeNull();return;}
 stream.mockImplementation(()=>new Promise(()=>{}));await click('.verify-again-action');expect(stream).toHaveBeenCalledTimes(1);
});

it('completed verification with insufficient evidence returns without changing learning or verdict',async()=>{
 const inquiry=w.inquiries[0];inquiry.intent='verify';inquiry.status='needs-verification';
 inquiry.messages[0].verification={verdict:'insufficient',summary:'资料不足',reason:'缺少直接依据',readingAdvice:'保留限制',claims:[],round:1,scope:'initial',completion:'complete'};
 inquiry.messages[0].search={status:'executed',completedSearches:1,failedSearches:0};
 await mount();const before=structuredClone(testWorkspace().inquiries[0]);
 await click('.return-to-list');expect(testWorkspace().inquiries[0]).toEqual(before);
 expect(host.querySelector('.category-items')?.textContent).toContain('已有结果');expect(stream).not.toHaveBeenCalled();
 await click('.category-open');expect(host.querySelector('.primary-action')).toBeNull();
});

it.each(['unknown','failed','not-executed'] as const)('only retries explicit failure for %s search, preserving legacy scope',async search=>{
 const inquiry=w.inquiries[0];inquiry.intent='verify';inquiry.status='needs-verification';
 const old=inquiry.messages[0];old.operation='verify';old.search={status:search,completedSearches:0,failedSearches:search==='failed'?1:0};
 old.verification={verdict:'incomplete',summary:'查证未完成',reason:'缺少搜索记录',readingAdvice:'保留限制',round:3,scope:'expanded',completion:'complete',claims:[]};
 stream.mockImplementation(()=>new Promise(()=>{}));await mount();
 if(search!=='failed'){expect(host.querySelector('.verify-again-action')).toBeNull();expect(stream).not.toHaveBeenCalled();return;}
 expect((host.querySelector('.verify-again-action') as HTMLButtonElement).disabled).toBe(false);expect(host.querySelector('.regenerate-action')).toBeNull();
 expect(host.querySelector('.verification-summary')?.textContent).not.toContain('可以再试一次');expect(host.querySelector('.verification-summary')?.textContent).not.toContain('本轮公开网页搜索未找到');
 await click('.verify-again-action');const request=stream.mock.calls[0][0];expect(request.operation).toBe('verify');expect(request.scope).toBe('expanded');expect(request.round).toBe(3);
 expect(host.querySelector('.verify-again-action')).toBeNull();expect(host.querySelector('.stop-action')).not.toBeNull();
 expect(testWorkspace().inquiries[0].messages[0]).toMatchObject({id:old.id,verification:{verdict:'incomplete',round:3}});
});

it('keeps function identity across keyboard tabs, exact-anchor switches and list returns without generation',async()=>{
 const base=w.inquiries[0];w.inquiries.push({...base,id:'verify',intent:'verify'},{...base,id:'entity',intent:'entity'});
 await mount();
 for(const [key,id] of [['ArrowRight','verify'],['End','ask'],['Home','explain']] as const){
  await act(async()=>host.querySelector('[role=tab][aria-selected=true]')!.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})));
  expect(host.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-intent')).toBe(id);
  expect(document.activeElement?.id).toBe('intent-tab-'+id);
 }
 await click('.category-open');
 await choose('select[aria-label="历史记录"]','entity');
 const active=host.querySelector<HTMLElement>('mark.is-active')!;
 expect(active.dataset.intent).toBe('entity');
 expect(active.getAttribute('style')).toBeNull();
 expect(active.classList.contains('is-emphasized')).toBe(true);
 expect(host.querySelector('#intent-tab-explain')!.getAttribute('style')).toBeNull();
 await click('.return-to-list');await click('[data-inquiry-id=entity]');
 expect(host.querySelector<HTMLElement>('mark.is-active')?.dataset.intent).toBe('entity');
 expect(stream).not.toHaveBeenCalled();
});

it('shows two neutral selection actions and optional questions without requesting a model until an action is chosen',async()=>{
 await mount();
 const p=host.querySelector('.markdown-article p')!;
 const range=document.createRange();range.selectNodeContents(p);
 Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,value:()=>({left:300,top:200,bottom:220,width:100,height:20,right:400})});
 const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 const raf=vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{callback(0);return 0;});
 await act(async()=>{p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
 raf.mockRestore();
 const buttons=[...host.querySelectorAll<HTMLElement>('.selection-actions [data-intent]')];
 expect(buttons.map(b=>b.dataset.intent)).toEqual(['explain','verify']);
 expect(buttons.every(b=>!b.getAttribute('style') && b.querySelector('svg'))).toBe(true);
 expect(stream).not.toHaveBeenCalled();
 await click('.selection-toolbar .question-toggle');
 const input=host.querySelector<HTMLTextAreaElement>('.selection-toolbar textarea')!;
 await act(async()=>input.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0})));
 expect(host.querySelector('.selection-toolbar textarea')).toBe(input);
 await act(async()=>document.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0})));
 expect(host.querySelector('.selection-toolbar')).toBeNull();expect(selection.rangeCount).toBe(0);
 const immediate=vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{callback(0);return 0;});
 await act(async()=>p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})));
 immediate.mockRestore();expect(host.querySelector('.selection-toolbar')).toBeNull();expect(stream).not.toHaveBeenCalled();
 selection.removeAllRanges();delete (Range.prototype as any).getBoundingClientRect;
});

it('category keyboard focus only previews a valid anchor and never saves, scrolls or generates',async()=>{
 w.inquiries.push({...w.inquiries[0],id:'missing',anchor:{...w.inquiries[0].anchor,blockId:'missing',quote:'不存在'}});
 await mount();
 // Finish the document's initial scroll restoration before measuring keyboard focus.
 await act(async()=>new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve())));
 await click('#intent-tab-explain');
 const saved=JSON.stringify(testWorkspace());
 vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
 await act(async()=>host.querySelector<HTMLButtonElement>('.category-items [data-inquiry-id="explain"]')!.focus());
 await act(async()=>new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve())));
 expect(host.querySelectorAll('mark.is-emphasized')).toHaveLength(1);
 expect(host.querySelector('.answer-markdown')).toBeNull();
 expect(JSON.stringify(testWorkspace())).toBe(saved);
 expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
 await act(async()=>host.querySelector<HTMLButtonElement>('.category-items [data-inquiry-id="missing"]')!.focus());
 expect(host.querySelector('mark.is-emphasized')).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('.category-items [data-inquiry-id="explain"]')!.focus());
 await act(async()=>host.querySelector<HTMLButtonElement>('#intent-tab-explain')!.focus());
 expect(host.querySelector('mark.is-emphasized')).toBeNull();
 expect(JSON.stringify(testWorkspace())).toBe(saved);
 expect(stream).not.toHaveBeenCalled();
});
it('same-anchor navigation includes current intent and preserves its chosen history and all independent states',async()=>{
 const base=w.inquiries[0];
 w.inquiries.push({...base,id:'older',updatedAt:'2025',status:'understood',messages:[{id:'older-answer',role:'assistant',content:'旧版独立解释',createdAt:'2025'}]}, {...base,id:'verify',intent:'verify',status:'needs-verification'}, {...base,id:'why',intent:'why'});
 await mount();await choose('select[aria-label="历史记录"]','older');
 const before=JSON.stringify(testWorkspace().inquiries);
 expect([...host.querySelectorAll('.anchor-requests button')].map(b=>b.textContent)).toEqual(['解释','来源','为什么']);
 await click('.anchor-requests [aria-current=true]');
 expect(host.querySelector('.answer-markdown')?.textContent).toContain('旧版独立解释');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.anchor-requests button')].find(b=>b.textContent==='来源')!.click());
 expect(host.querySelector('.anchor-requests [aria-current=true]')?.textContent).toBe('来源');
 expect(JSON.stringify(testWorkspace().inquiries)).toBe(before);
 expect(stream).not.toHaveBeenCalled();
});
it('historical fixed explanation retry keeps local history and auto mode',async()=>{
 w.inquiries[0].status='understood';
 stream.mockRejectedValueOnce(new Error('受控失败'));
 await mountLegacyRetry();await click('.regenerate-action');
 const first=stream.mock.calls[0][0];expect(first.operation).toBe('explain');expect(first.explanationMode).toBe('auto');expect(first.modelConfig.model).toBe('gpt-6.1-sol');expect(first.history[0].content).toBe('已有解释');
 expect(testWorkspace().inquiries[0].messages[0].content).toBe('已有解释');expect(host.querySelectorAll('.regenerate-action')).toHaveLength(1);
 stream.mockImplementation(async(request:InquiryRequest,cb:any)=>{cb({requestId:request.requestId,sequence:1,type:'complete',response:{answer:'联网补充结果',sources:[{id:'s',title:'官方定义',url:'https://example.org/',domain:'example.org',retrievalStatus:'unavailable'}],search:{status:'executed',completedSearches:1,failedSearches:0},evidenceStatus:'not-applicable',mode:'live',providerId:'codex',providerName:'Codex'}});});
 await click('.regenerate-action');expect(stream.mock.calls[1][0].explanationMode).toBe('auto');expect(stream.mock.calls[1][0].modelConfig).toEqual(first.modelConfig);
 expect([...host.querySelectorAll('.explanation-sources')].at(-1)?.textContent).toContain('正文未取得');expect([...host.querySelectorAll('.explanation-sources')].at(-1)?.textContent).not.toContain('历史评估记录');
 expect(host.querySelector('.explain-again-action')).toBeNull();expect(host.querySelector('.regenerate-action')).toBeNull();expect(testWorkspace().inquiries[0].messages.some(m=>m.explanationMode==='auto')).toBe(true);
});
it('historical explanation retry locks while running and stops without losing history',async()=>{
 stream.mockImplementation((_r:InquiryRequest,_cb:any,s:AbortSignal)=>new Promise((_,reject)=>s.addEventListener('abort',()=>reject(new Error('已中断')))));
 await mountLegacyRetry();await click('.regenerate-action');expect((host.querySelector('.question-toggle') as HTMLButtonElement).disabled).toBe(true);await click('.stop-action');expect(host.querySelector('.stop-action')).toBeNull();expect(host.querySelector('.regenerate-action')).not.toBeNull();expect(testWorkspace().inquiries[0].messages[0].content).toBe('已有解释');
});
it('does not expose retired explanation shortcuts when the provider cannot search',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({models:TEST_MODELS,providers:[{id:'codex',name:'Codex',availability:'connected',supportsWebSearch:false}],defaultProviderId:'codex'})})));
 await mount();expect(host.querySelector('.explanation-web-action')).toBeNull();expect(host.querySelector('.explain-again-action')).toBeNull();expect(stream).not.toHaveBeenCalled();
});

it('PDF image auto retry keeps the saved crop and auto mode; navigation does not change evidence',async()=>{
 const h='a'.repeat(64),cropId='b'.repeat(64);w.document={id:w.document.id,filename:'safe.pdf',kind:'pdf',contentHash:h,isDemo:false,importedAt:'2026',pdf:{resourceId:h,pages:[{view:[0,0,400,300],rotation:0}]}};
 w.inquiries[0].anchor.pdf={kind:'region',source:'image',fileHash:h,page:1,rects:[[20,20,100,100]],cropId};w.inquiries[0].messages[0].evidenceStatus='not-applicable';stream.mockRejectedValue(new Error('controlled network failure'));
 const entry=await testLibraryRequest('/entries',{workspace:w,creationKey:'pdf-test'}) as {id:string};await testLibraryRequest(`/entries/${entry.id}/activate`,{});
 await mountLegacyRetry();await click('.regenerate-action');const first=stream.mock.calls[0][0];expect(first.image).toMatchObject({fileHash:h,cropId});expect(first.image.entryId).toBeTruthy();expect(first.explanationMode).toBe('auto');
 await click('.regenerate-action');expect(stream.mock.calls[1][0].image).toEqual(first.image);expect(stream.mock.calls[1][0].explanationMode).toBe('auto');
 stream.mockImplementation(async(request:InquiryRequest,cb:any)=>{cb({requestId:request.requestId,sequence:1,type:'complete',response:{answer:'controlled completion',sources:[],search:{status:'not-executed',completedSearches:0,failedSearches:0},evidenceStatus:'not-applicable',mode:'live',providerId:'codex',providerName:'Codex'}});});
 await click('.regenerate-action');await click('.return-to-list');expect(host.querySelector('.primary-action')).toBeNull();
 expect(testWorkspace().inquiries[0].status).not.toBe('understood');expect(testWorkspace().inquiries[0].messages[0].evidenceStatus).toBe('not-applicable');
});

it('retains explicit legacy web mode when retrying an old failed answer',async()=>{
 w.inquiries[0].messages.push({...w.inquiries[0].messages[0],id:'old-web',explanationMode:'web',operation:'explain',completion:'interrupted'});w.inquiries[0].lastError='old failure';
 await mount();await click('.regenerate-action');expect(stream.mock.calls[0][0].explanationMode).toBe('web');expect(host.querySelector('.explanation-web-action')).toBeNull();
});
it('retains old corrected OCR and crop after removing detail controls and uses them on retry',async()=>{
 const h='a'.repeat(64),cropId='b'.repeat(64);w.document={id:w.document.id,filename:'safe.pdf',kind:'pdf',contentHash:h,isDemo:false,importedAt:'2026',pdf:{resourceId:h,pages:[{view:[0,0,400,300],rotation:0}]}};
 w.inquiries[0].anchor.pdf={kind:'region',source:'image',fileHash:h,page:1,rects:[[20,20,100,100]],cropId,ocrId:'c'.repeat(64),originalText:'2096',context:'20%'};
 w.inquiries[0].status='understood';w.inquiries[0].completedAt='2026-01-01';
 const entry=await testLibraryRequest('/entries',{workspace:w,creationKey:'correction-test'})as {id:string};await testLibraryRequest(`/entries/${entry.id}/activate`,{});
 await mountLegacyRetry();expect(host.querySelector('.pdf-source-preview')).toBeNull();expect(host.querySelector('textarea')).toBeNull();
 const before=structuredClone(testWorkspace().inquiries[0]);await click('.return-to-list');await click('.category-open');
 expect(testWorkspace().inquiries[0]).toEqual(before);
 await click('.regenerate-action');expect(stream.mock.calls[0][0]).toMatchObject({context:'20%',explanationMode:'auto',image:{fileHash:h,cropId}});
 expect(testWorkspace().inquiries[0].anchor.pdf).toEqual(before.anchor.pdf);
});

it('deletes only after two clicks, preserves shared anchors, and restores the saved deletion',async()=>{
 const base=w.inquiries[0];w.inquiries.push({...base,id:'entity',intent:'entity'});
 await mount();await click('#intent-tab-explain');
 expect(host.querySelector('.category-delete')).toBeNull();await click('#inquiry-delete-toggle');
 await click('[data-delete-inquiry-id="explain"]');
 expect(testWorkspace().inquiries).toHaveLength(2);expect(host.querySelector('.category-delete')?.getAttribute('aria-label')).toBe('确认删除知识贴：CAGR');
 expect(host.querySelector('.answer-markdown')).toBeNull();
 await click('[data-delete-inquiry-id="explain"]');
 expect(testWorkspace().inquiries.map(i=>i.id)).toEqual(['entity']);expect(host.querySelector('mark[data-inquiry-id]')).not.toBeNull();
 expect(host.querySelector('#intent-tab-explain')?.textContent).toBe('解释一下(1)');expect(host.querySelectorAll('.category-delete')).toHaveLength(1);expect(stream).not.toHaveBeenCalled();
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<App/>));
 expect(testWorkspace().inquiries.map(i=>i.id)).toEqual(['entity']);
 await click('#intent-tab-explain');await click('#inquiry-delete-toggle');await click('[data-delete-inquiry-id="entity"]');await click('[data-delete-inquiry-id="entity"]');
 expect(host.querySelector('mark[data-inquiry-id]')).toBeNull();expect(testWorkspace().document.markdown).toBe(w.document.markdown);
});
it('has one pending confirmation and resets it on Escape, mode exit, tab and detail changes',async()=>{
 w.inquiries.push({...w.inquiries[0],id:'second'});await mount();await click('#intent-tab-explain');await click('#inquiry-delete-toggle');
 await click('[data-delete-inquiry-id="explain"]');await click('[data-delete-inquiry-id="second"]');
 expect(host.querySelectorAll('.category-delete.confirming')).toHaveLength(1);expect(host.querySelector('.confirming')?.getAttribute('data-delete-inquiry-id')).toBe('second');
 await act(async()=>host.querySelector('.confirming')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(host.querySelector('.category-delete')).toBeNull();expect(host.querySelector('#inquiry-delete-toggle')).toBe(document.activeElement);
 await click('#inquiry-delete-toggle');await click('[data-delete-inquiry-id="explain"]');await click('#inquiry-delete-toggle');await click('#inquiry-delete-toggle');
 expect(host.querySelector('.confirming')).toBeNull();await click('[data-delete-inquiry-id="explain"]');await click('.category-open');await click('#intent-tab-explain');
 expect(host.querySelector('.category-delete')).toBeNull();await click('#inquiry-delete-toggle');await click('[data-delete-inquiry-id="explain"]');await click('#intent-tab-ask');await click('#intent-tab-explain');
 expect(host.querySelector('.category-delete')).toBeNull();expect(testWorkspace().inquiries).toHaveLength(2);expect(stream).not.toHaveBeenCalled();
});
it('aborts a deleted running thread and ignores late delta, complete and failure events',async()=>{
 let emit!:(event:InquiryEvent)=>void,signal!:AbortSignal,fail!:(e:Error)=>void;
 stream.mockImplementation((_r:any,cb:any,s:AbortSignal)=>{emit=cb;signal=s;return new Promise<void>((_,reject)=>fail=reject);});
 await mountLegacyRetry();await click('.regenerate-action');const request=stream.mock.calls[0][0];await click('#intent-tab-explain');await click('#inquiry-delete-toggle');await click('[data-delete-inquiry-id="explain"]');
 expect(signal.aborted).toBe(false);await click('[data-delete-inquiry-id="explain"]');expect(signal.aborted).toBe(true);
 await act(async()=>{emit({type:'answer-delta',requestId:request.requestId,sequence:1,delta:'迟到增量'});emit({type:'complete',requestId:request.requestId,sequence:2,response:{answer:'迟到内容',mode:'live',providerId:'codex',providerName:'Codex',sources:[],evidenceStatus:'not-applicable'}});fail(new Error('迟到错误'));});
 expect(testWorkspace().inquiries).toEqual([]);expect(host.textContent).not.toContain('迟到');expect(host.querySelector('.tab-busy')).toBeNull();
});

async function typeQuestion(text:string) {
 await act(async()=>{const input=host.querySelector<HTMLTextAreaElement>('.question-composer textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));});
}
it('opens a lightweight question input without generating, submits a separate anchored question and retains it on failed retry',async()=>{
 stream.mockRejectedValue(new Error('受控提问失败'));await mount();
 await click('.question-toggle');expect(stream).not.toHaveBeenCalled();expect((host.querySelector('.question-composer [type=submit]')as HTMLButtonElement).disabled).toBe(true);
 await typeQuestion('这里的增长率怎么算？');await click('.question-composer [type=submit]');
 expect(stream).toHaveBeenCalledTimes(1);const request=stream.mock.calls[0][0];
 expect(request).toMatchObject({intent:'ask',operation:'ask',explanationMode:'auto',question:'这里的增长率怎么算？',quote:'CAGR'});
 expect(request.history).toContainEqual({role:'assistant',content:'已有解释'});
 const saved=testWorkspace();expect(saved.inquiries).toHaveLength(2);expect(saved.inquiries[0].messages).toEqual(w.inquiries[0].messages);
 expect(host.querySelector('.current-question')?.textContent).toContain('这里的增长率怎么算？');expect(host.querySelectorAll('.anchor-requests button')).toHaveLength(2);
 await click('.regenerate-action');expect(stream.mock.calls[1][0]).toMatchObject({question:request.question,history:request.history,operation:'ask',explanationMode:'auto'});
});
it('keeps first-open explanation, exact question selection, persisted last-view memory and independent followups',async()=>{
 const base=w.inquiries[0];w.inquiries.push({...base,id:'verify',intent:'verify'},...['a','b'].map(id=>({...base,id,intent:'ask' as const,question:'具体问题'+id,messages:[{...base.messages[0],id:'answer'+id,content:'回答'+id,operation:'ask' as const}]})));
 w.activeInquiryId=null;w.activeTab={intent:'explain'};
 stream.mockImplementation(async(request,cb)=>cb({type:'complete',sequence:1,requestId:request.requestId,response:{answer:'补充回答',sources:[],evidenceStatus:'not-applicable',mode:'live',providerId:'codex',providerName:'Codex'}}));
 await mount();await click('mark[data-inquiry-id]');expect(host.querySelector('.answer-markdown')?.textContent).toContain('已有解释');
 expect([...host.querySelectorAll('.anchor-requests button')].map(b=>b.textContent)).toEqual(['解释','来源','我的问题']);
 expect(host.querySelector('.anchor-requests')?.textContent).not.toContain('具体问题');
 await click('#intent-tab-ask');await click('.category-open[data-inquiry-id=b]');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.anchor-requests button')].find(b=>b.textContent==='来源')!.click());
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.anchor-requests button')].find(b=>b.textContent==='我的问题')!.click());
 expect(host.querySelector('.answer-markdown')?.textContent).toContain('回答b');expect(stream).not.toHaveBeenCalled();
 await click('.return-to-list');await click('mark[data-inquiry-id]');expect(host.querySelector('.current-question')?.textContent).toContain('具体问题b');
 await click('.question-toggle');await typeQuestion('能再举个例子吗？');await click('.question-composer [type=submit]');
 expect(testWorkspace().inquiries).toHaveLength(4);expect(testWorkspace().inquiries.find(i=>i.id==='b')?.messages.at(-1)?.content).toBe('补充回答');
 expect(testWorkspace().inquiries.find(i=>i.id==='a')?.messages).toHaveLength(1);
 expect(stream.mock.calls[0][0].history).toContainEqual({role:'assistant',content:'回答b'});
 expect(host.querySelector('.current-question')?.textContent).toContain('能再举个例子吗');
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<App/>));
 await click('.return-to-list');await click('mark[data-inquiry-id]');expect(host.querySelector('.answer-markdown')?.textContent).toContain('补充回答');expect(stream).toHaveBeenCalledTimes(1);
});
it('allows explicit source selection without default explanation overriding it and blocks simultaneous questions',async()=>{
 const base=w.inquiries[0];w.inquiries.push({...base,id:'v',intent:'verify',lastError:'受控失败'});stream.mockImplementation(()=>new Promise(()=>{}));await mount();
 await click('#intent-tab-verify');await click('[data-inquiry-id=v]');
 expect(host.querySelector('.anchor-requests [aria-current=true]')?.textContent).toBe('来源');expect(stream).not.toHaveBeenCalled();
 await click('.verify-again-action');expect((host.querySelector('.question-toggle')as HTMLButtonElement).disabled).toBe(true);expect(stream).toHaveBeenCalledTimes(1);
});

it('opens a collapsed result from its original mark and preserves it through explicit hide and reopen',async()=>{
 localStorage.setItem('got-it.result-panel-pinned.v1','false');
 await mount();
 const panel=()=>host.querySelector('.right-panel') as HTMLElement;
 expect(panel().hasAttribute("inert")).toBe(true);
 await click('mark[data-inquiry-id="explain"]');
 expect(panel().hasAttribute("inert")).toBe(false);expect(host.querySelector('.answer-markdown')?.textContent).toContain('已有解释');
 await act(async()=>panel().dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body})));
 await act(async()=>new Promise(r=>setTimeout(r,250)));
 expect(panel().hasAttribute("inert")).toBe(false);
 await click('[aria-label="收起知识贴"]');expect(panel().hasAttribute("inert")).toBe(true);
 await click('[aria-label="展开知识贴"]');expect(panel().hasAttribute("inert")).toBe(false);
 expect(host.querySelector('.answer-markdown')?.textContent).toContain('已有解释');expect(stream).not.toHaveBeenCalled();
 expect(testWorkspace().activeInquiryId).toBe('explain');
});
it('a model response completing after explicit collapse does not reopen the panel',async()=>{
 localStorage.setItem('got-it.result-panel-pinned.v1','false');
 let emit!:(event:InquiryEvent)=>void,finish!:()=>void;
 stream.mockImplementation((_r:InquiryRequest,cb:any)=>{emit=cb;return new Promise<void>(r=>finish=r);});
 await mountLegacyRetry();await click('mark[data-inquiry-id="explain"]');await click('.regenerate-action');
 const request=stream.mock.calls[0][0];
 await click('[aria-label="收起知识贴"]');
 await act(async()=>{emit({type:'complete',requestId:request.requestId,sequence:1,response:{answer:'折叠后完成',mode:'live',providerId:'codex',providerName:'Codex',sources:[],evidenceStatus:'not-applicable'}});finish();});
 expect(host.querySelector('.right-panel')!.hasAttribute("inert")).toBe(true);expect(stream).toHaveBeenCalledTimes(1);
 await click('[aria-label="展开知识贴"]');expect(host.querySelector('.answer-markdown')?.textContent).toContain('折叠后完成');
});
it('settings Escape takes precedence over closing the unpinned result',async()=>{
 localStorage.setItem('got-it.result-panel-pinned.v1','false');await mount();
 await click('mark[data-inquiry-id="explain"]');await click('.provider-trigger');
 await act(async()=>host.querySelector('.provider-popover')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect((host.querySelector('.provider-shell') as HTMLElement).hidden).toBe(true);expect(host.querySelector('.right-panel')!.hasAttribute("inert")).toBe(false);
 await act(async()=>host.querySelector('.right-panel')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(host.querySelector('.right-panel')!.hasAttribute("inert")).toBe(true);
});
it('narrow result close retains the desktop pin preference',async()=>{
 vi.stubGlobal('matchMedia',vi.fn((query:string)=>({matches:query.includes('780'),addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 localStorage.setItem('got-it.result-panel-pinned.v1','true');await mount();
 expect(host.querySelector('.right-panel')!.hasAttribute("inert")).toBe(true);
 await click('mark[data-inquiry-id="explain"]');expect(host.querySelector('.right-panel')!.hasAttribute("inert")).toBe(false);
 await click('[aria-label="关闭知识贴"]');expect(host.querySelector('.right-panel')!.hasAttribute("inert")).toBe(true);
 expect(localStorage.getItem('got-it.result-panel-pinned.v1')).toBe('true');
});

it('isolates PDF scrolling and layout when switching back to Markdown', async()=>{
 w.inquiries=[];w.activeInquiryId=null;
 const markdown=await testLibraryRequest('/entries',{workspace:w,creationKey:'switch-markdown'}) as {id:string};
 const pdf=structuredClone(w),hash='a'.repeat(64);
 pdf.document={id:'switch-pdf',filename:'switch.pdf',kind:'pdf',contentHash:hash,isDemo:false,importedAt:'2026',pdf:{resourceId:hash,pages:[{view:[0,0,400,300],rotation:0}]}};
 const entry=await testLibraryRequest('/entries',{workspace:pdf,creationKey:'switch-pdf'}) as {id:string};
 await testLibraryRequest(`/entries/${entry.id}/activate`,{});
 await mount();
 const pdfScroll=host.querySelector<HTMLElement>('.reader-scroll--pdf')!;
 expect(pdfScroll).not.toBeNull();pdfScroll.scrollLeft=800;
 await click('.library-current');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.library-open')].find(button=>button.textContent===w.document.filename)!.click());
 const markdownScroll=host.querySelector<HTMLElement>('.reader-scroll')!;
 expect(markdownScroll).not.toBe(pdfScroll);
 expect(markdownScroll.classList.contains('reader-scroll--pdf')).toBe(false);
 expect(markdownScroll.scrollLeft).toBe(0);
 expect(host.querySelector('.markdown-article')).not.toBeNull();
 expect(host.querySelector('[aria-label="AI 连接与模型设置"]')).not.toBeNull();
 expect(testWorkspace().document.id).toBe(w.document.id);
 expect(markdown.id).not.toBe(entry.id);
 expect(stream).not.toHaveBeenCalled();
});
