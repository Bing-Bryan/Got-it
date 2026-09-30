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
afterEach(async()=>{await act(async()=>root.unmount());host.remove();localStorage.removeItem(STORAGE_KEY);vi.unstubAllGlobals();});
it('categories list the whole document and highlights open their own results without generating',async()=>{
 const base=w.inquiries[0];
 w.inquiries.push({...base,id:'mini',intent:'entity',anchor:{...base.anchor,quote:'MiniMax',start:100,end:107},messages:[{id:'m',role:'assistant',content:'MiniMax介绍',createdAt:'2026'}]});
 w.inquiries.push({...base,id:'other',intent:'entity',anchor:{...base.anchor,quote:'Replika',start:200,end:207}});
 await mount();await click('#intent-tab-entity');
 expect(host.querySelector('.category-items')?.textContent).toContain('MiniMax');expect(host.querySelector('.category-items')?.textContent).toContain('Replika');
 expect(host.querySelector('.answer-markdown')).toBeNull();await click('.category-open');
 expect(host.querySelector('.answer-markdown')?.textContent).toContain('MiniMax介绍');
 await click('#intent-tab-explain');expect(host.querySelector('.category-items')?.textContent).toContain('CAGR');expect(host.querySelector('.category-items')?.textContent).not.toContain('MiniMax');
 await click('.category-open');expect(host.querySelector('.answer-markdown')?.textContent).toContain('已有解释');
 await click('#intent-tab-verify');expect(host.querySelector('.category-items')?.textContent).toContain('还没有');expect(host.querySelector('.empty-intent button')).toBeNull();
 expect(stream).not.toHaveBeenCalled();expect(testWorkspace().activeTab).toEqual({intent:'verify'});
});
it('same anchor exposes only existing needs and request completion never steals category focus',async()=>{
 const base=w.inquiries[0];w.inquiries.push({...base,id:'entity',intent:'entity'});
 let emit!:(event:InquiryEvent)=>void,finish!:()=>void;
 stream.mockImplementation((_r:InquiryRequest,cb:any)=>{emit=cb;return new Promise<void>(r=>finish=r);});
 await mount();expect(host.querySelector('.anchor-requests')?.textContent).toContain('介绍');expect(host.querySelector('.anchor-requests')?.textContent).not.toContain('来源');
 await click('.anchor-requests button:not([aria-current])');expect(host.querySelector('[role=tab][aria-selected=true]')?.id).toBe('intent-tab-entity');
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
 w.activeInquiryId='why';await mount();expect(host.querySelector('.result-navigation')?.textContent).toContain('为什么');expect(host.textContent).toContain('旧为什么回答');
 await click('#intent-tab-explain');await click('.category-open');await choose('select[aria-label="历史记录"]','older');expect(host.textContent).toContain('更早的解释');expect(stream).not.toHaveBeenCalled();
});
it('uses all catalog models, changes incompatible effort to official default, and preserves other intent preferences',async()=>{
 await mount();await choose('select[aria-label="当前用途的模型"]','gpt-6-astra');await choose('select[aria-label="当前用途的推理强度"]','ultra');
 await choose('select[aria-label="当前用途的模型"]','gpt-5.5');
 const effort=host.querySelector('select[aria-label="当前用途的推理强度"]') as HTMLSelectElement;
 expect(effort.value).toBe('medium');expect([...effort.options].map(o=>o.value)).toEqual(['low','medium','high','xhigh']);
 await click('#intent-tab-entity');expect((host.querySelector('select[aria-label="当前用途的模型"]') as HTMLSelectElement).value).toBe('gpt-6-luna');expect(stream).not.toHaveBeenCalled();
});
it('repairs removed preferences without blocking, fails without a fixture catalog, and refreshes without generating',async()=>{
 let failed=false;
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>({ok:!failed,json:async()=>input.includes('/models')?failed?{error:'连接中断'}:{models:TEST_MODELS.filter(m=>m.model!=='gpt-6-luna')}:{providers:[{id:'codex',name:'Codex',availability:'connected',supportsWebSearch:true}],defaultProviderId:'codex'}})));
 await mount();expect(host.querySelector('[role=alert]')).toBeNull();expect((host.querySelector('.explain-again-action') as HTMLButtonElement).disabled).toBe(false);
 expect((host.querySelector('select[aria-label="当前用途的模型"]') as HTMLSelectElement).value).toBe('gpt-5.6-sol');
 expect(testWorkspace().modelPreferences!.explain).toEqual({model:'gpt-5.6-sol',reasoningEffort:'medium'});
 failed=true;await act(async()=>{const details=host.querySelector('.model-settings') as HTMLDetailsElement;details.open=true;details.dispatchEvent(new Event('toggle'));});expect(host.querySelector('[role=alert]')?.textContent).toContain('连接中断');expect((host.querySelector('select[aria-label="当前用途的模型"]') as HTMLSelectElement).disabled).toBe(true);
 failed=false;await click('.model-controls [role=alert] button');expect(host.querySelector('.model-controls [role=alert]')).toBeNull();expect(stream).not.toHaveBeenCalled();
});
it('restores legacy empty anchor tabs as category pages without creating requests',async()=>{
 w.inquiries[0].intent='verify';w.activeTab={anchorInquiryId:w.inquiries[0].id,intent:'explain'};
 await mount();expect(host.querySelector('.category-items')?.textContent).toContain('还没有解释概念');expect(host.querySelector('.empty-intent button')).toBeNull();expect(stream).not.toHaveBeenCalled();
});
it('restores an independent category list after reload',async()=>{
 w.activeInquiryId=null;w.activeTab={intent:'entity'};await mount();
 expect(host.querySelector('[role=tab][aria-selected=true]')?.id).toBe('intent-tab-entity');expect(host.querySelector('.answer-markdown')).toBeNull();expect(stream).not.toHaveBeenCalled();
});
it('replacing a document preserves preferences, clears search and aborts old requests',async()=>{
 let signal:AbortSignal|undefined;
 stream.mockImplementation((_request:any,_cb:any,s:AbortSignal)=>{signal=s;return new Promise<void>((_resolve,reject)=>s.addEventListener('abort',()=>reject(new Error('aborted'))));});
 HTMLElement.prototype.scrollTo=vi.fn();vi.spyOn(window,'confirm').mockReturnValue(true);
 w.modelPreferences={explain:{model:'gpt-5.5',reasoningEffort:'high'}};
 await mount();await click('.explain-again-action');
 const file=new File(['# 新文档\n新正文'],'next.md',{type:'text/markdown'});Object.defineProperty(file,'text',{value:async()=>'# 新文档\n新正文'});
 await act(async()=>{const input=host.querySelector('input[type=file]') as HTMLInputElement;Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(signal?.aborted).toBe(true);
 const stored=testWorkspace();expect(stored.document.filename).toBe('next.md');expect(stored.inquiries).toEqual([]);expect(stored.modelPreferences!.explain).toEqual({model:'gpt-5.5',reasoningEffort:'high'});expect(host.textContent).toContain('新正文');expect(stream).toHaveBeenCalledTimes(1);
});
it('stopping a request preserves history, aborts transport and ignores late completion',async()=>{
 let emit!:(event:InquiryEvent)=>void,signal!:AbortSignal,finish!:()=>void;
 stream.mockImplementation((_r:any,cb:any,s:AbortSignal)=>{emit=cb;signal=s;return new Promise<void>(r=>finish=r);});
 await mount();await click('.explain-again-action');const request=stream.mock.calls[0][0];
 const stop=[...host.querySelectorAll<HTMLButtonElement>('button')].find(e=>e.textContent==='停止本次请求')!;
 await act(async()=>stop.click());expect(signal.aborted).toBe(true);expect(host.textContent).toContain('已停止本次请求');
 await act(async()=>{emit({requestId:request.requestId,sequence:9,type:'complete',response:{answer:'迟到结果',sources:[],providerId:'codex',providerName:'Codex',mode:'live',evidenceStatus:'not-applicable'}});finish();});
 expect(host.textContent).not.toContain('迟到结果');expect(host.textContent).toContain('已有解释');
});
it('followups after failed attempts omit empty historical messages and retry preserves that boundary',async()=>{
 w.inquiries[0].messages.unshift({id:'empty',role:'assistant',content:'',completion:'interrupted',createdAt:'2025'});
 stream.mockRejectedValue(new Error('测试失败'));
 await mount();await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='再解释下')!.click());
 expect(stream.mock.calls[0][0].history.every((m:any)=>m.content.trim())).toBe(true);
 await click('.regenerate-action');expect(stream.mock.calls[1][0].history.every((m:any)=>m.content.trim())).toBe(true);
});
it('migrates old workspace defaults once to GPT-6 without rewriting historical model snapshots',async()=>{
 w.modelDefaultsVersion=2;w.modelPreferences={explain:{model:'gpt-5.6-luna',reasoningEffort:'max'},entity:{model:'gpt-5.6-sol',reasoningEffort:'medium'},verify:{model:'gpt-5.5',reasoningEffort:'high'}};
 w.inquiries[0].messages[0].modelConfig={model:'gpt-5.6-luna',reasoningEffort:'max'};
 await mount();const saved=testWorkspace();
 expect(saved.modelDefaultsVersion).toBe(3);expect(saved.modelPreferences!.explain).toEqual({model:'gpt-6-luna',reasoningEffort:'low'});expect(saved.modelPreferences!.entity).toEqual({model:'gpt-6-luna',reasoningEffort:'low'});expect(saved.modelPreferences!.verify).toEqual({model:'gpt-5.5',reasoningEffort:'high'});
 expect(saved.inquiries[0].messages[0].modelConfig).toEqual({model:'gpt-5.6-luna',reasoningEffort:'max'});expect(stream).not.toHaveBeenCalled();
});
it('renders deltas before completion, keeps them provisional and preserves partial text on stop',async()=>{
 let emit!:(event:InquiryEvent)=>void;
 stream.mockImplementation((_r:InquiryRequest,cb:any,signal:AbortSignal)=>{emit=cb;return new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('中断'))));});
 await mount();await click('.explain-again-action');const request=stream.mock.calls[0][0];
 await act(async()=>{emit({type:'answer-delta',delta:'这是',requestId:request.requestId,sequence:1});emit({type:'answer-delta',delta:'逐步解释',requestId:request.requestId,sequence:2});});
 expect(host.querySelectorAll('.answer-markdown')[1].textContent?.trim()).toBe('这是逐步解释');expect(host.textContent).toContain('正在生成，内容尚未完成');
 const saved=testWorkspace();expect(saved.inquiries[0].messages.at(-1)?.completion).toBe('provisional');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes('停止'))!.click());
 expect(host.textContent).toContain('这是逐步解释');expect(testWorkspace().inquiries[0].messages.at(-1)?.completion).toBe('interrupted');
 await act(async()=>emit({type:'answer-delta',delta:'迟到内容',requestId:request.requestId,sequence:3}));expect(host.textContent).not.toContain('迟到内容');
});
it('shows model controls inside the closed provider menu and exposes secondary actions alongside completion',async()=>{
 await mount();expect((host.querySelector('.model-settings') as HTMLDetailsElement).open).toBe(true);expect((host.querySelector('.provider-shell') as HTMLElement).hidden).toBe(true);expect(host.querySelector('.more-actions')).toBeNull();expect(host.querySelector('.compact-actions')?.textContent).toContain('再解释下');
 expect(host.querySelector('.anchor-card')).toBeNull();expect(host.querySelector('.user-message')).toBeNull();expect(host.querySelector('.inquiry-head')).toBeNull();expect((host.querySelector('.category-items') as HTMLElement).hidden).toBe(true);
 await click('.result-navigation button');expect((host.querySelector('.category-items') as HTMLElement).hidden).toBe(false);expect(host.querySelector('.answer-markdown')).toBeNull();expect(stream).not.toHaveBeenCalled();
});
it.each([[99, '(99)'], [100, '(99+)']] as const)('renders single-line tab icons and count %s with zero hidden',async(count,label)=>{
 const base=w.inquiries[0];w.inquiries=Array.from({length:count},(_,i)=>({...base,id:'i'+i}));w.activeInquiryId='i0';await mount();
 expect(host.querySelector('#intent-tab-explain')?.textContent).toBe('解释概念'+label);expect(host.querySelector('#intent-tab-verify')?.textContent).toBe('查找来源');
 expect(host.querySelectorAll('.inquiry-tabs button > svg').length).toBe(3);expect(host.querySelector('.inquiry-tabs small')).toBeNull();
});

it('keeps actions stable after completion and allows explaining again without reopening',async()=>{
 stream.mockRejectedValue(new Error('测试请求失败'));
 await mount();await click('.compact-actions .primary-action');
 expect(host.querySelector('.compact-actions')?.textContent).not.toContain('重新打开');
 expect((host.querySelector('.explain-again-action') as HTMLButtonElement).disabled).toBe(false);
 await click('.explain-again-action');
 const request=stream.mock.calls[0][0];expect(request.operation).toBe('explain');expect(request.question).toContain('更简单');expect(request.question).toContain('日常生活例子');
 expect(host.querySelector('.answer-history')?.textContent).toContain('已有解释');
});
it('keeps legacy distilled records readable and complete without distillation controls',async()=>{
 w.inquiries[0].status='distilled';w.inquiries[0].messages[0].evidenceStatus='unsupported';await mount();
 const saved=testWorkspace().inquiries[0];
 expect(saved.status).toBe('distilled');expect(saved.messages[0].evidenceStatus).toBe('unsupported');expect(saved.messages).toHaveLength(1);
 expect(host.querySelector('.distill-action')).toBeNull();expect(host.querySelector('.undo-popover')).toBeNull();
 expect(host.querySelector('.compact-actions .primary-action')?.textContent).toBe('已理解');
 expect((host.querySelector('.explain-again-action') as HTMLButtonElement).disabled).toBe(false);expect(stream).not.toHaveBeenCalled();
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
it('recheck is the single verification followup and carries evidence gaps, round and parent through retry',async()=>{
 w.inquiries[0].intent='verify';w.inquiries[0].messages[0].verification={verdict:'partial',summary:'只支持一部分',reason:'缺少同年份资料',readingAdvice:'保留限制',claims:[],round:3,scope:'expanded',completion:'complete'};
 w.inquiries[0].messages[0].sources=[{id:'s1',title:'已有来源',url:'https://example.com',domain:'example.com'}];
 stream.mockRejectedValue(new Error('受控查证失败'));await mount();
 expect([...host.querySelectorAll('.compact-actions button')].map(b=>b.textContent)).toEqual(['再找一下','明白了，继续阅读']);
 await click('.verify-again-action');const first=stream.mock.calls[0][0];
 expect(first.operation).toBe('verify');expect(first.scope).toBe('expanded');expect(first.round).toBe(4);expect(first.parentMessageId).toBe('old');expect(first.previous.verification.reason).toBe('缺少同年份资料');expect(first.previous.sources[0].id).toBe('s1');expect(first.modelConfig.model).toBe('gpt-6-astra');
 expect((host.querySelector('.verify-again-action') as HTMLButtonElement).disabled).toBe(false);
 await click('.verify-again-action');const retry=stream.mock.calls[1][0];expect(retry.round).toBe(4);expect(retry.previous).toEqual(first.previous);expect(retry.scope).toBe('expanded');expect(retry.operation).toBe('verify');
 expect(testWorkspace().inquiries[0].messages[0].verification?.round).toBe(3);
});
it('moves legacy DeepSeek selection to Codex, preserving answers and using Codex for new requests',async()=>{
 w.activeProviderId='deepseek';w.modelDefaultsVersion=3;
 w.modelPreferences={explain:{model:'gpt-5.5',reasoningEffort:'high'}};
 w.inquiries[0].messages[0].providerId='deepseek';
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({models:TEST_MODELS,providers:[{id:'codex',name:'Codex',availability:'connected',supportsWebSearch:true},{id:'deepseek',name:'DeepSeek',availability:'connected',supportsWebSearch:false}],defaultProviderId:'deepseek'})})));
 stream.mockRejectedValue(new Error('受控请求失败'));
 await mount();await click('.provider-trigger');
 expect(host.querySelector('.provider-popover')?.textContent).not.toMatch(/DeepSeek|API Key|本地实验/);
 expect(host.querySelectorAll('.provider-option')).toHaveLength(1);
 expect(host.querySelector('#deepseek-key')).toBeNull();
 expect(testWorkspace().activeProviderId).toBe('codex');
 expect(testWorkspace().modelPreferences!.explain).toEqual({model:'gpt-5.5',reasoningEffort:'high'});
 expect(testWorkspace().inquiries[0].messages[0].providerId).toBe('deepseek');
 expect(host.textContent).toContain('已有解释');expect(stream).not.toHaveBeenCalled();
 await click('.explain-again-action');expect(stream.mock.calls[0][0]).toMatchObject({providerId:'codex',modelConfig:{model:'gpt-5.5',reasoningEffort:'high'}});
});

it.each(['incomplete','interrupted','failed'] as const)('acknowledges unfinished source searches persistently without rewriting results: %s',async state=>{
 const inquiry=w.inquiries[0];inquiry.intent='verify';inquiry.status='needs-verification';
 const message=inquiry.messages[0];message.verification={verdict:'incomplete',summary:'未完成',reason:'未确认搜索',readingAdvice:'保留限制',claims:[],round:1,scope:'initial',completion:state==='interrupted'?'interrupted':'complete'};
 if(state==='interrupted') message.completion='interrupted';
 if(state==='failed') inquiry.lastError='受控失败';
 await mount();const before=testWorkspace().inquiries[0];
 expect(host.querySelector('.compact-actions .primary-action')?.textContent).toBe('暂时先这样');
 expect((host.querySelector('.compact-actions .primary-action') as HTMLButtonElement).disabled).toBe(false);
 expect(inquiryCategoryStatus(inquiry)).not.toBe('已查找');
 await click('.compact-actions .primary-action');
 expect(host.querySelector('.inquiry-panel-content')).toBeNull();
 const stored=testWorkspace().inquiries[0];
 expect(stored.status).toBe('understood');expect(stored.completedAt).toBeTruthy();
 expect(stored.messages).toEqual(before.messages);expect(stored.lastError).toBe(before.lastError);
 expect(host.querySelector('.category-items')?.textContent).toContain('已查找');
 expect(stream).not.toHaveBeenCalled();
 await click('.category-open');expect(host.querySelector('.compact-actions .primary-action')?.textContent).toBe('已查找');
 expect((host.querySelector('.compact-actions .primary-action') as HTMLButtonElement).disabled).toBe(true);
 w=testWorkspace();await act(async()=>root.unmount());root=createRoot(host);await mount();
 expect(host.querySelector('.compact-actions .primary-action')?.textContent).toBe('已查找');
 stream.mockImplementation(()=>new Promise(()=>{}));await click('.verify-again-action');expect(stream).toHaveBeenCalledTimes(1);
 expect(testWorkspace().inquiries[0].status).toBe('answering');
});

it('completed verification with insufficient evidence confirms understanding without changing the verdict',async()=>{
 const inquiry=w.inquiries[0];inquiry.intent='verify';inquiry.status='needs-verification';
 inquiry.messages[0].verification={verdict:'insufficient',summary:'资料不足',reason:'缺少直接依据',readingAdvice:'保留限制',claims:[],round:1,scope:'initial',completion:'complete'};
 inquiry.messages[0].search={status:'executed',completedSearches:1,failedSearches:0};
 await mount();expect(host.querySelector('.compact-actions .primary-action')?.textContent).toBe('明白了，继续阅读');
 await click('.compact-actions .primary-action');expect(host.querySelector('.inquiry-panel-content')).toBeNull();
 const stored=testWorkspace().inquiries[0];expect(stored.status).toBe('understood');expect(stored.messages[0].verification?.verdict).toBe('insufficient');
 expect(host.querySelector('.category-items')?.textContent).toContain('已查找');expect(stream).not.toHaveBeenCalled();
 await click('.category-open');expect(host.querySelector('.compact-actions .primary-action')?.textContent).toBe('已查找');expect((host.querySelector('.compact-actions .primary-action') as HTMLButtonElement).disabled).toBe(true);
});

it.each(['unknown','failed','not-executed'] as const)('retries incomplete verification with %s search without expanding or losing history',async search=>{
 const inquiry=w.inquiries[0];inquiry.intent='verify';inquiry.status='needs-verification';
 const old=inquiry.messages[0];old.operation='verify';old.search={status:search,completedSearches:0,failedSearches:search==='failed'?1:0};
 old.verification={verdict:'incomplete',summary:'查证未完成',reason:'缺少搜索记录',readingAdvice:'保留限制',round:3,scope:'expanded',completion:'complete',claims:[]};
 stream.mockImplementation(()=>new Promise(()=>{}));await mount();
 expect((host.querySelector('.verify-again-action') as HTMLButtonElement).disabled).toBe(false);expect(host.querySelector('.regenerate-action')).toBeNull();
 expect(host.querySelector('.verification-summary')?.textContent).not.toContain('可以再试一次');expect(host.querySelector('.verification-summary')?.textContent).not.toContain('本轮公开网页搜索未找到');
 await click('.verify-again-action');const request=stream.mock.calls[0][0];expect(request.operation).toBe('verify');expect(request.scope).toBe('expanded');expect(request.round).toBe(3);
 expect((host.querySelector('.verify-again-action') as HTMLButtonElement).disabled).toBe(true);expect(host.querySelector('.stop-action')).not.toBeNull();
 expect(testWorkspace().inquiries[0].messages[0]).toMatchObject({id:old.id,verification:{verdict:'incomplete',round:3}});
});

it('keeps function identity across keyboard tabs, exact-anchor switches and learning completion without generation',async()=>{
 const base=w.inquiries[0];w.inquiries.push({...base,id:'verify',intent:'verify'},{...base,id:'entity',intent:'entity'});
 await mount();
 for(const [key,id] of [['ArrowRight','verify'],['End','entity'],['Home','explain']] as const){
  await act(async()=>host.querySelector('[role=tab][aria-selected=true]')!.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})));
  expect(host.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-intent')).toBe(id);
  expect(document.activeElement?.id).toBe('intent-tab-'+id);
 }
 await click('.category-open');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.anchor-requests button')].find(b=>b.textContent==='介绍')!.click());
 const active=host.querySelector<HTMLElement>('mark.is-active')!;
 expect(active.dataset.intent).toBe('entity');
 expect(active.getAttribute('style')).toBeNull();
 expect(active.classList.contains('is-emphasized')).toBe(true);
 expect(host.querySelector('#intent-tab-entity')!.getAttribute('style')).toBeNull();
 await click('.compact-actions .primary-action');
 expect(host.querySelector<HTMLElement>('mark.is-active')?.dataset.intent).toBe('entity');
 expect(stream).not.toHaveBeenCalled();
});

it('shows three neutral selection actions without requesting a model until an action is chosen',async()=>{
 await mount();
 const p=host.querySelector('.markdown-article p')!;
 const range=document.createRange();range.selectNodeContents(p);
 Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,value:()=>({left:300,top:200,bottom:220,width:100,height:20,right:400})});
 const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 const raf=vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{callback(0);return 0;});
 await act(async()=>{p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
 raf.mockRestore();
 const buttons=[...host.querySelectorAll<HTMLElement>('.selection-actions [data-intent]')];
 expect(buttons.map(b=>b.dataset.intent)).toEqual(['explain','verify','entity']);
 expect(buttons.every(b=>!b.getAttribute('style') && b.querySelector('svg'))).toBe(true);
 expect(stream).not.toHaveBeenCalled();
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
it('auto explanation keeps local history, retries its mode, and simplify stays auto',async()=>{
 w.inquiries[0].status='understood';
 stream.mockRejectedValueOnce(new Error('受控失败'));
 await mount();await click('.explain-again-action');
 const first=stream.mock.calls[0][0];expect(first.operation).toBe('explain');expect(first.explanationMode).toBe('auto');expect(first.modelConfig.model).toBe('gpt-6-luna');expect(first.history[0].content).toBe('已有解释');
 expect(testWorkspace().inquiries[0].messages[0].content).toBe('已有解释');expect(host.querySelectorAll('.regenerate-action')).toHaveLength(1);
 stream.mockImplementation(async(request:InquiryRequest,cb:any)=>{cb({requestId:request.requestId,sequence:1,type:'complete',response:{answer:'联网补充结果',sources:[{id:'s',title:'官方定义',url:'https://example.org/',domain:'example.org',retrievalStatus:'unavailable'}],search:{status:'executed',completedSearches:1,failedSearches:0},evidenceStatus:'not-applicable',mode:'live',providerId:'codex',providerName:'Codex'}});});
 await click('.regenerate-action');expect(stream.mock.calls[1][0].explanationMode).toBe('auto');expect(stream.mock.calls[1][0].modelConfig).toEqual(first.modelConfig);
 expect([...host.querySelectorAll('.explanation-sources')].at(-1)?.textContent).toContain('正文未取得');expect([...host.querySelectorAll('.explanation-sources')].at(-1)?.textContent).not.toContain('历史评估记录');
 await click('.explain-again-action');expect(stream.mock.calls[2][0].explanationMode).toBe('auto');expect(testWorkspace().inquiries[0].messages.some(m=>m.explanationMode==='auto')).toBe(true);
});
it('auto explanation locks while running, stops without losing history, and remains disabled without search capability',async()=>{
 stream.mockImplementation((_r:InquiryRequest,_cb:any,s:AbortSignal)=>new Promise((_,reject)=>s.addEventListener('abort',()=>reject(new Error('已中断')))));
 await mount();await click('.explain-again-action');expect((host.querySelector('.explain-again-action') as HTMLButtonElement).disabled).toBe(true);await click('.stop-action');expect(host.querySelector('.stop-action')).toBeNull();expect(host.querySelector('.regenerate-action')).not.toBeNull();expect(testWorkspace().inquiries[0].messages[0].content).toBe('已有解释');
});
it('disables supplement with an explanation when the provider cannot search',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({models:TEST_MODELS,providers:[{id:'codex',name:'Codex',availability:'connected',supportsWebSearch:false}],defaultProviderId:'codex'})})));
 await mount();expect(host.querySelector('.explanation-web-action')).toBeNull();expect(host.querySelector('.recheck-unavailable')?.textContent).toContain('不支持联网');expect(stream).not.toHaveBeenCalled();
});

it('PDF image auto retry keeps the saved crop and auto mode; learning confirmation does not change evidence',async()=>{
 const h='a'.repeat(64),cropId='b'.repeat(64);w.document={id:w.document.id,filename:'safe.pdf',kind:'pdf',contentHash:h,isDemo:false,importedAt:'2026',pdf:{resourceId:h,pages:[{view:[0,0,400,300],rotation:0}]}};
 w.inquiries[0].anchor.pdf={kind:'region',source:'image',fileHash:h,page:1,rects:[[20,20,100,100]],cropId};w.inquiries[0].messages[0].evidenceStatus='not-applicable';stream.mockRejectedValue(new Error('controlled network failure'));
 const entry=await testLibraryRequest('/entries',{workspace:w,creationKey:'pdf-test'}) as {id:string};await testLibraryRequest(`/entries/${entry.id}/activate`,{});
 await mount();await click('.explain-again-action');const first=stream.mock.calls[0][0];expect(first.image).toMatchObject({fileHash:h,cropId});expect(first.image.entryId).toBeTruthy();expect(first.explanationMode).toBe('auto');
 await click('.regenerate-action');expect(stream.mock.calls[1][0].image).toEqual(first.image);expect(stream.mock.calls[1][0].explanationMode).toBe('auto');
 stream.mockImplementation(async(request:InquiryRequest,cb:any)=>{cb({requestId:request.requestId,sequence:1,type:'complete',response:{answer:'controlled completion',sources:[],search:{status:'not-executed',completedSearches:0,failedSearches:0},evidenceStatus:'not-applicable',mode:'live',providerId:'codex',providerName:'Codex'}});});
 await click('.regenerate-action');await click('.primary-action');expect(host.querySelector('.primary-action')?.textContent).toContain('已理解');
 expect(testWorkspace().inquiries[0].status).toBe('understood');expect(testWorkspace().inquiries[0].messages[0].evidenceStatus).toBe('not-applicable');
});

it('retains explicit legacy web mode when retrying an old failed answer',async()=>{
 w.inquiries[0].messages.push({...w.inquiries[0].messages[0],id:'old-web',explanationMode:'web',operation:'explain',completion:'interrupted'});w.inquiries[0].lastError='old failure';
 await mount();await click('.regenerate-action');expect(stream.mock.calls[0][0].explanationMode).toBe('web');expect(host.querySelector('.explanation-web-action')).toBeNull();
});
it('corrects recognized material in a new request while keeping the crop, original recognition and answer history',async()=>{
 const h='a'.repeat(64),cropId='b'.repeat(64);w.document={id:w.document.id,filename:'safe.pdf',kind:'pdf',contentHash:h,isDemo:false,importedAt:'2026',pdf:{resourceId:h,pages:[{view:[0,0,400,300],rotation:0}]}};
 w.inquiries[0].anchor.pdf={kind:'region',source:'image',fileHash:h,page:1,rects:[[20,20,100,100]],cropId,ocrId:'c'.repeat(64),originalText:'2096',context:'2096'};
 const entry=await testLibraryRequest('/entries',{workspace:w,creationKey:'correction-test'})as {id:string};await testLibraryRequest(`/entries/${entry.id}/activate`,{});
 await mount();const input=host.querySelector('textarea[aria-label="修正识别文字"]')as HTMLTextAreaElement;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'20%');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('.pdf-source-preview details:last-child button');
 expect(stream.mock.calls[0][0]).toMatchObject({context:'20%',explanationMode:'auto',image:{fileHash:h,cropId}});
 const saved=testWorkspace().inquiries[0];expect(saved.anchor.pdf).toMatchObject({originalText:'2096',context:'20%',rects:[[20,20,100,100]]});expect(saved.messages[0].content).toBe('已有解释');expect(saved.messages.some(m=>m.content.includes('修正识别文字：20%'))).toBe(true);
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
 expect(host.querySelector('#intent-tab-explain')?.textContent).toBe('解释概念');expect(host.querySelector('.category-delete')).toBeNull();expect(stream).not.toHaveBeenCalled();
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<App/>));
 expect(testWorkspace().inquiries.map(i=>i.id)).toEqual(['entity']);
 await click('#intent-tab-entity');await click('#inquiry-delete-toggle');await click('[data-delete-inquiry-id="entity"]');await click('[data-delete-inquiry-id="entity"]');
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
 expect(host.querySelector('.category-delete')).toBeNull();await click('#inquiry-delete-toggle');await click('[data-delete-inquiry-id="explain"]');await click('#intent-tab-entity');await click('#intent-tab-explain');
 expect(host.querySelector('.category-delete')).toBeNull();expect(testWorkspace().inquiries).toHaveLength(2);expect(stream).not.toHaveBeenCalled();
});
it('aborts a deleted running thread and ignores late delta, complete and failure events',async()=>{
 let emit!:(event:InquiryEvent)=>void,signal!:AbortSignal,fail!:(e:Error)=>void;
 stream.mockImplementation((_r:any,cb:any,s:AbortSignal)=>{emit=cb;signal=s;return new Promise<void>((_,reject)=>fail=reject);});
 await mount();await click('.explain-again-action');const request=stream.mock.calls[0][0];await click('#intent-tab-explain');await click('#inquiry-delete-toggle');await click('[data-delete-inquiry-id="explain"]');
 expect(signal.aborted).toBe(false);await click('[data-delete-inquiry-id="explain"]');expect(signal.aborted).toBe(true);
 await act(async()=>{emit({type:'answer-delta',requestId:request.requestId,sequence:1,delta:'迟到增量'});emit({type:'complete',requestId:request.requestId,sequence:2,response:{answer:'迟到内容',mode:'live',providerId:'codex',providerName:'Codex',sources:[],evidenceStatus:'not-applicable'}});fail(new Error('迟到错误'));});
 expect(testWorkspace().inquiries).toEqual([]);expect(host.textContent).not.toContain('迟到');expect(host.querySelector('.tab-busy')).toBeNull();
});
