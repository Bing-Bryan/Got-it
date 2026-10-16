// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';import type {Server} from 'node:http';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {parseInquiryRequest,ProviderService} from './providers';import {testModelCatalog} from './test-support/model-catalog';import {READING_MATERIALS_HEADER} from './prompt-materials';import {createApp} from './index';import {ReadingLibrary} from './reading-library';
const base={providerId:'codex',intent:'explain',quote:'安全选区',context:'有限上下文',question:'解释这段选中文字',history:[]};
it('rejects oversized source text, questions and context instead of silently slicing a successful request',()=>{
 for(const [field,limit] of [['quote',20000],['context',50000],['question',10000],['documentTitle',2000]] as const){
  expect(parseInquiryRequest({...base,[field]:'字'.repeat(limit)})[field]).toHaveLength(limit);
  expect(()=>parseInquiryRequest({...base,[field]:'字'.repeat(limit)+'尾'})).toThrow(expect.objectContaining({statusCode:400,code:field+'_too_long'}));
 }
 expect(()=>parseInquiryRequest({...base,intent:'ask',question:'问'.repeat(2001)})).toThrow(expect.objectContaining({code:'question_too_long'}));
 expect(()=>parseInquiryRequest({...base,intent:'ask',readingScope:'document',context:'文'.repeat(16001)})).toThrow(expect.objectContaining({code:'context_too_long'}));
 expect(()=>parseInquiryRequest({...base,history:[{role:'user',content:'长'.repeat(20001)}]})).toThrow(expect.objectContaining({code:'content_too_long'}));
});
it.each(['explain','verify','ask'] as const)('sends every selected block and exact boundary whitespace through the %s streaming prompt',async intent=>{
 const start='  # 安全标题\n\n第一段开始。',middle='\n- 列表项：限制条件。\n- 第二项：不能遗漏。\n\n',end='末段结论需要与前文一起理解。\n  ';
 const quote=start+'原文'.repeat(5800)+middle+end,context=' \n首端前文。\n末端后文。 \n';expect(quote.length).toBeGreaterThan(10000);
 const request=parseInquiryRequest({...base,intent,quote,context,question:intent==='ask'?'首段和末段有什么关系？':'处理选中文字'});let captured='';
 const turn=vi.fn(async options=>{captured=options.prompt;return{raw:JSON.stringify({answer:'安全受控测试回答',sources:[],verification:null,evidenceStatus:'not-applicable',calculation:null}),trace:''};});
 const service=new ProviderService({modelCatalog:testModelCatalog,execFileImpl:async()=>({stdout:'Logged in using ChatGPT',stderr:''}),codexTurnImpl:turn});
 await service.answer(request,{onEvent(){}});expect(turn).toHaveBeenCalledTimes(1);
 const data=JSON.parse(captured.split(READING_MATERIALS_HEADER)[1]);expect(data.quote).toBe(quote);expect(data.context).toBe(context);expect(data.quote.startsWith(start)).toBe(true);expect(data.quote.endsWith(end)).toBe(true);expect(data.question).toBe(request.question);
 expect(data.readingScope).toBe('selection');expect(data.quote).not.toContain('UNSELECTED_DOCUMENT_BODY');
});
let server:Server|undefined,dir='';afterEach(async()=>{if(server)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;if(dir)await rm(dir,{recursive:true,force:true});});
it('rejects oversized selections before either HTTP endpoint can call any Provider',async()=>{
 dir=await mkdtemp(join(tmpdir(),'got-it-inquiry-budget-'));const answer=vi.fn();const app=createApp({library:new ReadingLibrary(dir),providerService:{answer} as unknown as ProviderService});server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));const port=(server.address() as {port:number}).port;
 for(const route of ['inquiries','inquiries/stream']){const response=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,quote:'字'.repeat(20001)})});expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'quote_too_long'});}
 expect(answer).not.toHaveBeenCalled();
});
