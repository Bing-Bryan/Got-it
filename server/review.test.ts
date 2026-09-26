// @vitest-environment node
import { testModelCatalog } from "./test-support/model-catalog";
import { describe, expect, it, vi } from 'vitest';
import { writeFile, access } from 'node:fs/promises';
import { once } from 'node:events';
import { ProviderService, normalizeCodexResponse, parseInquiryRequest, runCommand } from './providers';
import { reconcile, describeRound } from './verification';
import { observeSearchLines } from './search-trace';
import { createApp } from './index';
import { rankSources, sourceAssessment, copyVerification, legacyEvidence } from '../src/lib/verification';
import { verifySources } from './source-reader';
import type { InquiryResponse, Source } from '../src/types';

const request = parseInquiryRequest({providerId:'codex',intent:'verify',quote:'18–34岁为行业主力，均为Z世代',question:'查证',history:[]});
const source: Source = {id:'s',title:'研究',url:'https://example.org/study',domain:'example.org',snippet:'The study sample is aged 18 to 25.',relation:'supports',reliability:'strong',reliabilityReasons:['原始调查说明抽样方法和样本量'],scope:'2025年特定样本18–25岁',differences:['不能代表18–34岁整个行业'],applicability:'background',origin:'original'};
const raw = (sources = [source]) => ({answer:'原句得到支持',evidenceStatus:'supported',sources,verification:{verdict:'supported',summary:'已确认行业结论',reason:'引文存在',readingAdvice:'可直接引用',claims:[{text:'18–34岁为行业主力',verdict:'supported',sourceIds:['s']},{text:'均为Z世代',verdict:'insufficient',sourceIds:[]}]}});
const trace = [{type:'turn.started'},{type:'item.started',item:{type:'web_search',id:'1'}},{type:'item.completed',item:{type:'web_search',id:'1',action:{type:'search',query:'private query'}}},{type:'turn.completed'}].map(e=>JSON.stringify(e)).join('\n')+'\n';
function response(sources = [source]): InquiryResponse { return {...normalizeCodexResponse(JSON.stringify(raw(sources)),request),search:{status:'executed',completedSearches:1,failedSearches:0}}; }

describe('independent evidence judgments',()=>{
 it('keeps high quality background first without replacing the industry conclusion',()=>{
  const result = reconcile(response([{...source,excerptKind:'quote',retrievalStatus:'matched'}]),true);
  expect(result.verification?.verdict).toBe('partial');
  expect(result.verification?.claims.map(c=>c.verdict)).toEqual(['partial','insufficient']);
  expect(result.answer).not.toContain('可直接引用');
  expect(result.verification?.summary).not.toContain('已确认行业');
  expect(result.sources[0].reliability).toBe('strong');
 });
 it('requires every claim and original non-secondary direct traceable evidence for support',()=>{
  const direct = {...source,applicability:'direct' as const,excerptKind:'quote' as const,retrievalStatus:'matched' as const};
  const r = response([direct]); r.sources = [direct]; r.verification!.claims = [r.verification!.claims[0]];
  expect(reconcile(r,true).verification?.verdict).toBe('supported');
  expect(reconcile(r,false).verification?.summary).toContain('仍在核对');
  const partial = {...r, verification:{...r.verification!,verdict:'partial' as const},sources:[{...direct,retrievalStatus:'unavailable' as const,excerptKind:'unverified' as const}]};
  expect(reconcile(partial,true).answer).not.toContain('可直接引用');
  expect(reconcile({...r,sources:[{...direct,origin:'secondary'}]},true).verification?.verdict).toBe('partial');
  expect(reconcile({...r,sources:[{...direct,retrievalStatus:'unavailable',excerptKind:'unverified'}]},true).answer).not.toContain('可直接引用');
 });
 it('sorts strong counterevidence first, then applicability; deduplicates tracking URLs and filters irrelevant',()=>{
  const ranked = rankSources([{...source,id:'weak',reliability:'moderate',applicability:'direct',url:'https://other.org/'},source,{...source,id:'counter',relation:'conflicts',applicability:'direct',url:'https://counter.org/'},{...source,id:'duplicate',url:source.url+'?utm_source=copy'},{...source,id:'irrelevant',applicability:'irrelevant',url:'https://no.org/'}]);
  expect(ranked.map(s=>s.id)).toEqual(['counter','s','weak']);
  expect(sourceAssessment({...source,reliabilityReasons:[]}).reliability).toBe('uncertain');
  expect(sourceAssessment({...source,scope:''}).reliability).toBe('uncertain');
 });
 it('normalizes missing/illegal fields and validates source IDs conservatively',()=>{
  expect(copyVerification(undefined)).toBeUndefined();
  expect(copyVerification({verdict:'__proto__'})?.verdict).toBe('incomplete');
  expect(()=>normalizeCodexResponse('raw CLI log',request)).toThrow('结构化');
  expect(()=>parseInquiryRequest({...request,scope:'infinite'})).toThrow('scope');
  expect(()=>parseInquiryRequest({...request,operation:'magic'})).toThrow('operation');
  const v=copyVerification({verdict:'magic',round:-1,completion:'done',claims:[{text:'claim',verdict:'supported',sourceIds:['secret']} ]});
  expect(v).toMatchObject({verdict:'incomplete',round:1,completion:'interrupted',claims:[{sourceIds:[]}]});
  expect(['conflicting','insufficient'].map(v=>legacyEvidence(v as 'conflicting'))).toEqual(['unsupported','unsupported']);
 });
 it('expanded rounds with duplicate/reprinted evidence do not claim new support',()=>{
  const r=response(); const previous={verification:r.verification!,sources:r.sources};
  expect(describeRound(r,{...request,previous}).verification?.changeNote).toContain('没有新增可靠依据');
 });
});

describe('bounded streaming execution',()=>{
 it('observes chunked lines and ignores unknown, truncated and model-log progress',()=>{
  const events:string[]=[];const observe=observeSearchLines(p=>events.push(p));
  for(const chunk of trace.match(/.{1,7}|\n/g)!) observe(chunk);
  observe('{"type":"future","text":"SECRET"}\n{"type":"item.started"');
  expect(events).toEqual(['search-started','search-completed']);
 });
 it('kills timed-out, cancelled and excessive-output child processes',async()=>{
  await expect(runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:20})).rejects.toMatchObject({code:'ETIMEDOUT'});
  const c=new AbortController();const pending=runCommand(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{signal:c.signal});c.abort();await expect(pending).rejects.toThrow('中断');
  await expect(runCommand(process.execPath,['-e','console.log("x".repeat(2048));setInterval(()=>{},1000)'],{maxBuffer:100})).rejects.toMatchObject({code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'});
 });
 it('streams preliminary over HTTP before delayed body, preserves JSON endpoint and cleans temp dirs',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let reading=false;
  const dirs:string[]=[];
  const service=new ProviderService({modelCatalog: testModelCatalog,execFileImpl:async(_f,args,opts)=>{
   if(args[0]==='login')return{stdout:'Logged in using ChatGPT',stderr:''};
   dirs.push(String(opts.cwd));opts.onStdout?.(trace);
   const valid=raw([{...source,applicability:'direct'}]);valid.verification.claims=[valid.verification.claims[0]];
   await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(valid));
   return{stdout:trace,stderr:'SECRET LOG'};
  },codexTurnImpl:async opts=>{
   dirs.push(opts.cwd);opts.onDelta('原句');opts.onTrace(trace);
   const valid=raw([{...source,applicability:'direct'}]);valid.verification.claims=[valid.verification.claims[0]];
   return {raw:JSON.stringify(valid),trace};
  },sourceReader:async url=>{reading=true;await gate;return{url,text:source.snippet!};}});
  const server=createApp({providerService:service}).listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
   const res=await fetch(base+'/api/inquiries/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,requestId:'test'})});
   const reader=res.body!.getReader();let received='';
   while(!received.includes('"type":"preliminary"')){received+=new TextDecoder().decode((await reader.read()).value);}
   expect(reading).toBe(true);expect(received).not.toContain('"type":"complete"');expect(received).not.toContain('SECRET');expect(received).not.toContain('private query');
   release();while(true){const chunk=await reader.read();if(chunk.done)break;received+=new TextDecoder().decode(chunk.value);}
   const events=received.trim().split('\n').map(l=>JSON.parse(l));expect(events.at(-1).type).toBe('complete');expect(events.at(-1).response.verification.verdict).toBe('supported');expect(events.find(e=>e.type==='preliminary').response.verification.summary).toContain('仍在核对');expect(events.map(e=>e.sequence)).toEqual(events.map((_,i)=>i+1));
   expect(events.at(-1).timings.preliminary).toBeLessThan(events.at(-1).timings.complete);
   expect(events.find(e=>e.type==='answer-delta').timings.firstText).toBeLessThanOrEqual(events.at(-1).timings.preliminary);
   expect(events.find(e=>e.type==='answer-delta').response).toBeUndefined();
   const json=await fetch(base+'/api/inquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});expect((await json.json()).verification.completion).toBe('complete');
   for(const dir of dirs)await expect(access(dir)).rejects.toThrow();
  }finally{release();server.close();server.closeAllConnections();}
 });
 it('explicit explanation on a verify thread does not search; expanded passes gaps and has bounded sources',async()=>{
  const calls:string[][]=[];const service=new ProviderService({modelCatalog: testModelCatalog,execFileImpl:async(_f,args)=>{if(args[0]==='login')return{stdout:'Logged in using ChatGPT',stderr:''};calls.push([...args]);await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(raw([])));return{stdout:trace,stderr:''};}});
  await service.answer({...request,operation:'explain'});expect(calls[0]).not.toContain('--search');expect(calls[0].at(-1)).toContain('本次不是联网核查');
  await service.answer({...request,intent:'entity',operation:'explain',quote:'Replika 或图灵'});
  expect(calls[1]).not.toContain('--search');expect(calls[1].at(-1)).toContain('阅读意图：explain');expect(calls[1].at(-1)).toContain('具体例子');
  calls.pop();
  await service.answer({...request,scope:'expanded',previous:{verification:response().verification!,sources:[source]}});
  expect(calls[1].at(-1)).toContain('最多输出 5');expect(calls[1].at(-1)).toContain('前轮结果与缺口');
  for(const providerId of ['demo','deepseek'] as const)await expect(service.answer({...request,providerId,scope:'expanded'})).rejects.toMatchObject({code:'search_unavailable'});
  let count=0;await verifySources(Array.from({length:7},()=>source),async url=>{count++;return{url,text:source.snippet!};},{scope:'expanded'});expect(count).toBe(5);
 });
});

describe('abort and expanded budget boundaries',()=>{
 it('cancels a disconnected HTTP client and cleans the running request',async()=>{
  let aborted=false,release!:()=>void;
  const entered=new Promise<void>(resolve=>release=resolve);
  const service=new ProviderService({modelCatalog: testModelCatalog,execFileImpl:async(_f,args,opts)=>{
   if(args[0]==='login')return{stdout:'Logged in using ChatGPT',stderr:''};
   release();await new Promise<void>((_,reject)=>opts.signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('cancelled'));},{once:true}));
   return{stdout:'',stderr:''};
  },codexTurnImpl:async opts=>{release();await new Promise<void>((_,reject)=>opts.signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('cancelled'));},{once:true}));return {raw:'',trace:''};}});
  const server=createApp({providerService:service}).listen(0,'127.0.0.1');await once(server,'listening');
  const controller=new AbortController();
  try{
   const res=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/inquiries/stream`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal});
   await entered;controller.abort();await res.body?.cancel().catch(()=>{});
   await new Promise<void>((resolve,reject)=>{const deadline=Date.now()+1000;const poll=()=>aborted?resolve():Date.now()>deadline?reject(new Error('not cancelled')):setTimeout(poll,5);poll();});
   expect(aborted).toBe(true);
  }finally{server.close();server.closeAllConnections();}
 });
 it('aborts a stalled body immediately rather than waiting for a page budget',async()=>{
  const controller=new AbortController();
  const pending=verifySources([source],async()=>new Promise(()=>{}),{signal:controller.signal,scope:'expanded'});
  controller.abort();await expect(pending).rejects.toThrow();
 });
 it('ends expanded body verification after the 30 second budget without automatic continuation',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);let count=0;
  try {
   const pending=verifySources(Array.from({length:6},()=>source),async()=>{count++;await new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),Math.min(8000,30000-Date.now())));return {url:source.url,text:''};},{scope:'expanded'});
   await vi.advanceTimersByTimeAsync(30000);const results=await pending;
   expect(count).toBe(4);expect(results[4].retrievalStatus).toBe('not-read');
  } finally { vi.useRealTimers(); }
 });

});
