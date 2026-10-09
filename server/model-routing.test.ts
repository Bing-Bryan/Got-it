// @vitest-environment node
import { testModelCatalog } from "./test-support/model-catalog";
import { expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { ProviderService, parseInquiryRequest } from './providers';
import { modelConfig } from '../src/lib/model-routing';
import { READING_MATERIALS_HEADER } from './prompt-materials';
const request=parseInquiryRequest({providerId:'codex',intent:'explain',quote:'CAGR',question:'解释',history:[]});
it.each([false, true])('routes a legacy why request through explanation (streaming=%s) without changing its history', async streaming => {
 const legacy = parseInquiryRequest({...request, intent:'why', history:[{role:'assistant',content:'保留的旧回答'}]});
 const original = structuredClone(legacy);
 const raw = JSON.stringify({answer:'本轮解释',sources:[],evidenceStatus:'not-applicable',verification:null});
 let prompt = '', searchable = true;
 const service = new ProviderService({modelCatalog:testModelCatalog,
  codexTurnImpl:async options => {prompt=options.prompt;searchable=options.searchable;return {raw,trace:''};},
  execFileImpl:async (_file,args) => {
   if(args[0]==='login')return {stdout:'Logged in using ChatGPT',stderr:''};
   prompt=args.at(-1)!;searchable=args.includes('--search');
   await writeFile(args[args.indexOf('--output-last-message')+1],raw);
   return {stdout:'',stderr:''};
  },
 });
 const response=await service.answer(legacy,streaming ? {onEvent:()=>{}} : {});
 expect(prompt).toContain('阅读意图：explain');
 expect(JSON.parse(prompt.split(READING_MATERIALS_HEADER)[1]).history).toEqual([{role:'assistant',content:'保留的旧回答'}]);
 expect(prompt).not.toContain('拆解原因、推理链和关键前提');
 expect(searchable).toBe(false);
 expect(response.modelConfig).toEqual(modelConfig('explain'));
 expect(response.verification).toBeUndefined();
 expect(legacy).toEqual(original);
});
it('routes all intents to real CLI parameters; explicit user choice wins and explanation followups never search', async()=>{
 const calls:readonly string[][]=[];
 const service=new ProviderService({modelCatalog: testModelCatalog,execFileImpl:async(_file,args)=>{
  if(args[0]==='login')return {stdout:'Logged in using ChatGPT',stderr:''};
  (calls as string[][]).push([...args]);
  await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify({answer:'用于路由测试的输出',sources:[],evidenceStatus:'not-applicable',verification:null}));
  return {stdout:'{"type":"turn.started"}\n{"type":"turn.completed"}\n',stderr:''};
 }});
 for(const intent of ['explain','entity','verify'] as const){
  const response=await service.answer({...request,intent});const args=calls.at(-1)!;
  expect(args[args.indexOf('--model')+1]).toBe(modelConfig(intent).model);
  expect(args).toContain(`model_reasoning_effort="${modelConfig(intent).reasoningEffort}"`);
  expect(args.includes('--search')).toBe(intent!=='explain');
  expect(response.modelConfig).toEqual(modelConfig(intent));
  if(intent==='entity')expect(response.verification).toBeUndefined();
 }
 const choice={model:'gpt-5.6-terra',reasoningEffort:'low'} as const;
 await service.answer({...request,intent:'entity',operation:'explain',modelConfig:choice});
 expect(calls.at(-1)).not.toContain('--search');expect(calls.at(-1)).toContain(choice.model);expect(calls.at(-1)).toContain('model_reasoning_effort="low"');
});
it('rejects invalid model or effort and does not accept raw CLI configuration',()=>{
 for(const config of [{model:'--search',reasoningEffort:'medium'},{model:'gpt-5.6-sol',reasoningEffort:'invalid'}])expect(()=>parseInquiryRequest({...request,modelConfig:config})).toThrow('模型或推理强度');
 const parsed=parseInquiryRequest({...request,modelConfig:{...modelConfig('verify'),apiKey:'secret',args:['--dangerously-bypass-approvals-and-sandbox']}});
 expect(parsed.modelConfig).toEqual(modelConfig('verify'));
});
it('model rejection is visible and never triggers a second model or demo answer',async()=>{
 let calls=0;
 const service=new ProviderService({modelCatalog: testModelCatalog,execFileImpl:async(_f,args)=>{if(args[0]==='login')return {stdout:'Logged in using ChatGPT',stderr:''};calls++;throw new Error('unsupported model');}});
 await expect(service.answer(request)).rejects.toThrow('gpt-6.1-sol / medium');expect(calls).toBe(1);
});
it('entity search is observable, remains outside verification, and cannot expand its source budget',async()=>{
 let reads=0;
 const trace='{"type":"turn.started"}\n{"type":"item.completed","item":{"id":"s","type":"web_search","action":{"type":"search","query":"product"}}}\n{"type":"turn.completed"}\n';
 const service=new ProviderService({modelCatalog: testModelCatalog,sourceReader:async url=>{reads++;throw new Error('unavailable');},execFileImpl:async(_f,args)=>{
  if(args[0]==='login')return {stdout:'Logged in using ChatGPT',stderr:''};
  await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify({answer:'介绍结果',evidenceStatus:'supported',verification:null,sources:Array.from({length:6},(_,i)=>({id:String(i),title:'材料',url:`https://example.org/${i}`,snippet:'Product documentation text',relation:'related'}))}));
  return {stdout:trace,stderr:''};
 }});
 const response=await service.answer({...request,intent:'verify',operation:'entity',scope:'expanded'});
 expect(response.search?.status).toBe('executed');expect(response.verification).toBeUndefined();expect(response.evidenceStatus).toBe('not-applicable');
 expect(response.sources).toHaveLength(3);expect(reads).toBe(3);expect(response.sources.every(s=>s.retrievalStatus==='unavailable')).toBe(true);
});
it('gives verification a bounded independent budget and keeps explanation followups short',async()=>{
 const timeouts:number[]=[];
 const service=new ProviderService({modelCatalog:testModelCatalog,execFileImpl:async(_f,args,options)=>{
  if(args[0]==='login')return {stdout:'Logged in using ChatGPT',stderr:''};
  timeouts.push(options.timeout as number);
  await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify({answer:'预算测试',sources:[],evidenceStatus:'not-applicable',verification:null}));
  return {stdout:'',stderr:''};
 }});
 await service.answer({...request,intent:'verify'});await service.answer({...request,intent:'verify',operation:'explain'});
 expect(timeouts[0]).toBeGreaterThan(239000);expect(timeouts[0]).toBeLessThanOrEqual(240000);
 expect(timeouts[1]).toBeGreaterThan(119000);expect(timeouts[1]).toBeLessThanOrEqual(120000);
});
