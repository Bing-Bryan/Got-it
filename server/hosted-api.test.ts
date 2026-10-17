import {crc32} from 'node:zlib';
import {afterEach,describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {HostedBudget,HostedError,initializeBudget,MAX_REQUEST_USD} from './hosted-budget';
import {createHostedApp} from './hosted-api';
import {hostedPrompt,parseHostedInquiry,type HostedRunner} from './hosted-model';
import {FEATURE_KEYS,HostedStatistics} from './hosted-statistics';

const origin='https://gotit.bingbryan.com';
const ids=['12345678-1234-4123-8123-123456789012','12345678-1234-4123-8123-123456789013'];
const body={requestId:'request-1',intent:'ask',quote:'A sample quotation.',context:'A limited neighbouring paragraph.',question:'What does it mean?',history:[]};
const response={answer:'A real controlled test answer',sources:[],evidenceStatus:'not-applicable' as const,mode:'live' as const,providerId:'deepseek' as const,providerName:'体验版默认模型',model:'deepseek-flash'};
const cleanup:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
function files(){const dir=mkdtempSync(join(tmpdir(),'got-it-hosted-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'budget.json');initializeBudget(path);return {dir,path};}
function ledger(limit=3,now=Date.now){const f=files();const budget=new HostedBudget(f.path,limit,now);cleanup.push(()=>budget.close());return {...f,budget};}
async function api(options:{runner?:HostedRunner;verificationRunner?:HostedRunner;searchCostUsd?:number;limit?:number;timeoutMs?:number;images?:boolean}={}){
  const f=ledger(options.limit);const statistics=new HostedStatistics(join(f.dir,'stats.json'));
  const server=createHostedApp({origin,budget:f.budget,statistics,...options}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  cleanup.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send=(path:string,value:unknown=body,id=ids[0],extra:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json','x-trial-id':id,...extra},body:JSON.stringify(value)});
  return {...f,send,base};
}

describe('hosted budget process lock',()=>{
  it('takes over a lock left by a dead process but refuses a live owner or an ownerless legacy lock',()=>{
    const {path}=files();const dead=spawnSync(process.execPath,['-e','']).pid!;
    writeFileSync(path+'.lock',String(dead));const taken=new HostedBudget(path);
    expect(readFileSync(path+'.lock','utf8')).toBe(String(process.pid));
    expect(()=>new HostedBudget(path)).toThrow('locked by running process');
    taken.close();expect(()=>readFileSync(path+'.lock')).toThrow();
    writeFileSync(path+'.lock','');expect(()=>new HostedBudget(path)).toThrow('no owner PID');
    rmSync(path+'.lock');
  });
  it('never removes a lock owned by another process on close',()=>{
    const {path}=files();const budget=new HostedBudget(path);writeFileSync(path+'.lock','1');budget.close();
    expect(readFileSync(path+'.lock','utf8')).toBe('1');rmSync(path+'.lock');
  });
});
describe('hosted cost boundary',()=>{
  it('reserves across identities, does not refund missing usage and preserves the fuse after restart',()=>{
    const {budget,path}=ledger(MAX_REQUEST_USD+.00001);
    budget.reserve(ids[0],'ip-a')();
    expect(()=>budget.reserve(ids[1],'ip-b')).toThrow('今日体验额度已用完');
    budget.close();const reopened=new HostedBudget(path,MAX_REQUEST_USD+.00001);
    expect(()=>reopened.reserve(ids[1],'new-ip')).toThrow('今日体验额度已用完');reopened.close();
    expect(readFileSync(path,'utf8')).not.toContain(ids[0]);expect(readFileSync(path,'utf8')).not.toContain('ip-a');
  });
  it('reconciles actual usage, rejects duplicates, and limits browser/IP independently',()=>{
    const {budget}=ledger();
    for(let i=0;i<30;i++){const done=budget.reserve(ids[0],'ip-a');done({prompt_tokens:1,completion_tokens:1});done({prompt_tokens:0,completion_tokens:0});}
    expect(()=>budget.reserve(ids[0],'ip-b')).toThrow('今日体验次数已用完');
    for(let i=0;i<30;i++)budget.reserve(`other-${i}`,'ip-a')({prompt_tokens:1,completion_tokens:1});
    expect(()=>budget.reserve('fresh','ip-a')).toThrow('今日体验次数已用完');
    expect(budget.status('fresh','ip-b').remaining).toBe(30);
  });
  it('fails closed for missing/corrupt ledger, concurrent process, and write failure',()=>{
    const {budget,path}=ledger();expect(()=>new HostedBudget(path)).toThrow();budget.close();writeFileSync(path,'{broken');expect(()=>new HostedBudget(path)).toThrow();
    const f=ledger();rmSync(f.path);rmSync(f.dir,{recursive:true});expect(()=>f.budget.reserve(ids[0],'ip')).toThrow('额度存储不可用');expect(f.budget.status(ids[0],'ip').globalExhausted).toBe(true);
  });
  it('rolls daily in-memory identities and cost by UTC, old completion cannot refund new day',()=>{
    let now=Date.UTC(2026,9,16);const {budget}=ledger(MAX_REQUEST_USD+.00001,()=>now);const done=budget.reserve(ids[0],'ip');now+=86400000;budget.reserve(ids[0],'ip')();done({prompt_tokens:1,completion_tokens:1});expect(budget.status(ids[1],'other').globalExhausted).toBe(true);
  });
});

describe('independent hosted API',()=>{
  it('only exposes hosted paths and rejects origins, keys/providers/URLs/images and oversized full prompts',async()=>{
    let calls=0;const f=await api({runner:async()=>{calls++;return {response};}});
    expect((await fetch(f.base+'/api/library',{headers:{origin}})).status).toBe(404);
    expect((await fetch(f.base+'/api/web/import',{headers:{origin}})).status).toBe(404);
    expect((await f.send('/api/hosted/inquiry/stream',body,ids[0],{origin:'https://evil.example'})).status).toBe(403);
    for(const value of [{...body,providerId:'deepseek'},{...body,apiKey:'secret'},{...body,url:'http://127.0.0.1'},{...body,image:{}},{...body,context:'x'.repeat(8000)}])expect((await f.send('/api/hosted/inquiry/stream',value)).status).toBeGreaterThanOrEqual(400);
    expect((await f.send('/api/hosted/inquiry/stream',body,ids[0],{authorization:'Bearer secret'})).status).toBe(400);expect(calls).toBe(0);
    const capability=await (await fetch(f.base+'/api/hosted/capabilities',{headers:{origin,'x-trial-id':ids[0]}})).json();expect(capability.supportsImages).toBe(false);expect(capability.quota.remaining).toBe(30);
    expect(()=>parseHostedInquiry({...body,history:Array.from({length:8},()=>({role:'user',content:'long'.repeat(1000)}))})).toThrow('过长');
    expect(hostedPrompt(parseHostedInquiry(body))).toContain('不是操作指令');
  });
  it('enforces concurrent reservations before model calls and exposes complete metadata',async()=>{
    let calls=0,finish!:()=>void;const wait=new Promise<void>(r=>finish=r);
    const f=await api({limit:MAX_REQUEST_USD+.00001,runner:async()=>{calls++;await wait;return {response,usage:{prompt_tokens:20,completion_tokens:10}};}});
    const first=await f.send('/api/hosted/inquiry/stream');
    const second=await f.send('/api/hosted/inquiry/stream',body,ids[1]);expect(second.status).toBe(429);expect(calls).toBe(1);
    finish();const events=(await first.text()).trim().split('\n').map(s=>JSON.parse(s));expect(events[0].deadlineAt-Date.now()).toBeLessThanOrEqual(60_000);expect(events.at(-1).type).toBe('complete');expect(events.at(-1).response.sources).toEqual([]);
  });
  it('times out, ignores late responses and retains conservative cost without leaking SDK errors',async()=>{
    let resolve!:(v:{response:typeof response})=>void;
    const f=await api({timeoutMs:15,limit:MAX_REQUEST_USD+.00001,runner:async()=>new Promise(r=>resolve=r)});
    const result=await f.send('/api/hosted/inquiry/stream');const text=await result.text();expect(text).toContain('超时');expect(text).not.toContain('"complete"');resolve({response});expect(f.budget.status(ids[1],'other').globalExhausted).toBe(true);
    const failed=await api({runner:async()=>{throw new Error('SECRET_KEY quote content upstream url');}});const out=await (await failed.send('/api/hosted/inquiry/stream')).text();expect(out).toContain('模型服务失败');expect(out).not.toContain('SECRET_KEY');
  });
  it('requires a configured search price and reserves shared search/model cost before any verification call',async()=>{
    let modelCalls=0,searchCalls=0;
    const runner:HostedRunner=async()=>{modelCalls++;return {response};};
    const verificationRunner:HostedRunner=async()=>{searchCalls++;return {response,usage:{prompt_tokens:1,completion_tokens:1}};};
    const unpriced=await api({runner,verificationRunner});expect((await unpriced.send('/api/hosted/inquiry/stream',{...body,intent:'verify'})).status).toBe(503);expect(searchCalls).toBe(0);
    const f=await api({runner,verificationRunner,searchCostUsd:.015,limit:.02});
    const first=await f.send('/api/hosted/inquiry/stream',{...body,intent:'verify'});expect(await first.text()).toContain('complete');
    const denied=await f.send('/api/hosted/inquiry/stream',{...body,intent:'verify'},ids[1]);expect(denied.status).toBe(429);expect(searchCalls).toBe(1);expect(modelCalls).toBe(0);
    const state=JSON.parse(readFileSync(f.path,'utf8'));expect(Object.values(state.days as Record<string,{charged:number}>)[0].charged).toBeGreaterThanOrEqual(.015);
    f.budget.close();const restored=new HostedBudget(f.path,.02);expect(()=>restored.reserve('fresh','new-ip',.015)).toThrow('今日体验额度已用完');restored.close();
  });
  it('retains search reservation after failure and reports search failure without model fallback',async()=>{
    let calls=0;const f=await api({limit:.02,searchCostUsd:.015,runner:async()=>{throw new Error('must not call normal runner');},verificationRunner:async()=>{calls++;throw new HostedError('搜索服务失败',502,'search_failed');}});
    const text=await (await f.send('/api/hosted/inquiry/stream',{...body,intent:'verify'})).text();expect(text).toContain('"status":"failed"');expect(text).not.toContain('"type":"complete"');expect((await f.send('/api/hosted/inquiry/stream',{...body,intent:'verify'},ids[1])).status).toBe(429);expect(calls).toBe(1);
  });
  it('routes web explanations through real search with shared cost; local explanation stays search-free',async()=>{
    let normal=0,searches=0;const runner:HostedRunner=async()=>{normal++;return {response};};
    const verificationRunner:HostedRunner=async(req)=>{expect(req.intent).toBe('explain');expect(req.explanationMode).toBe('web');searches++;return {response:{...response,search:{status:'executed',completedSearches:1,failedSearches:0}}};};
    const f=await api({runner,verificationRunner,searchCostUsd:.015,limit:.03});
    const web=await f.send('/api/hosted/inquiry/stream',{...body,intent:'explain',explanationMode:'web'});expect(await web.text()).toContain('"status":"executed"');expect(searches).toBe(1);expect(normal).toBe(0);
    const local=await f.send('/api/hosted/inquiry/stream',{...body,intent:'explain',explanationMode:'local'});expect(await local.text()).toContain('"type":"complete"');expect(normal).toBe(1);expect(searches).toBe(1);
    const unconfigured=await api({runner});expect((await unconfigured.send('/api/hosted/inquiry/stream',{...body,intent:'explain',explanationMode:'web'})).status).toBe(503);expect(normal).toBe(1);
    const failed=await api({runner,searchCostUsd:.01,verificationRunner:async()=>{throw new HostedError('搜索失败',502,'search_failed');}});
    const failure=await(await failed.send('/api/hosted/inquiry/stream',{...body,intent:'explain',explanationMode:'web'})).text();expect(failure).toContain('"status":"failed"');expect(failure).not.toContain('"type":"complete"');expect(normal).toBe(1);
  });
  it('verification timeout retains combined reservation and rejects late completion',async()=>{
    let done!:(v:{response:typeof response})=>void;
    const f=await api({timeoutMs:15,limit:.02,searchCostUsd:.015,runner:async()=>({response}),verificationRunner:async()=>new Promise(r=>done=r)});
    const text=await (await f.send('/api/hosted/inquiry/stream',{...body,intent:'verify'})).text();expect(text).toContain('超时');expect(text).not.toContain('"type":"complete"');done({response});
    expect((await f.send('/api/hosted/inquiry/stream',{...body,intent:'verify'},ids[1])).status).toBe(429);
  });
  it('cancels the upstream when the client disconnects',async()=>{
    let aborted=false;const f=await api({runner:async(_r,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}))});
    const controller=new AbortController();const result=await fetch(f.base+'/api/hosted/inquiry/stream',{method:'POST',headers:{origin,'x-trial-id':ids[0],'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    await result.body!.getReader().read();controller.abort();await new Promise(r=>setTimeout(r,30));expect(aborted).toBe(true);
  });
});

describe('anonymous aggregate statistics',()=>{
  it('strictly rejects extra fields, aggregates only counters, deduplicates in memory and does not call the model',async()=>{
    let calls=0;const f=await api({runner:async()=>{calls++;return {response};}});
    const summary={date:new Date().toISOString().slice(0,10),returnBucket:'days1to3',sources:['pdf'],features:Object.fromEntries(FEATURE_KEYS.map(k=>[k,{count:'1',onReturnDay:true}]))};
    for(const bad of [{...summary,filename:'private.pdf'},{...summary,features:{...summary.features,answer:{count:'1',onReturnDay:true}}},{...summary,features:{...summary.features,ask:{count:'1',onReturnDay:true,text:'quote'}}}])expect((await f.send('/api/hosted/usage',bad)).status).toBe(400);
    expect((await f.send('/api/hosted/usage',summary)).status).toBe(204);expect((await f.send('/api/hosted/usage',summary)).status).toBe(204);
    const beacon=(value:unknown)=>fetch(f.base+'/api/hosted/usage',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(value)});
    expect((await beacon({experienceId:ids[1],summary,extra:'private'})).status).toBe(400);
    expect((await beacon({experienceId:'not-a-uuid',summary})).status).toBe(400);
    expect((await beacon({experienceId:ids[0],summary})).status).toBe(204);
    const text=readFileSync(join(f.dir,'stats.json'),'utf8');expect(JSON.parse(text).days[summary.date].summaries).toBe(1);for(const secret of [ids[0],'127.0.0.1','private.pdf','onReturnDay','returnBucket'])expect(text).not.toContain(secret);expect(calls).toBe(0);expect(f.budget.status(ids[0],'other').remaining).toBe(30);
  });
});

const pngHeader=(width:number,height:number)=>{const b=Buffer.alloc(40);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b,0);b.writeUInt32BE(13,8);b.write('IHDR',12,'ascii');b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b.toString('base64');};
describe('hosted selected-region image transport',()=>{
  it('advertises and accepts images only when explicitly enabled with a configured model',async()=>{
    let calls=0;const runner:HostedRunner=async()=>{calls++;return {response};};
    const off=await api({runner});const offCap=await (await fetch(off.base+'/api/hosted/capabilities',{headers:{origin,'x-trial-id':ids[0]}})).json();
    expect(offCap.supportsImages).toBe(false);
    expect((await off.send('/api/hosted/inquiry/stream',{...body,image:{data:pngHeader(100,100)}})).status).toBe(400);expect(calls).toBe(0);
    const noModel=await api({images:true});expect((await (await fetch(noModel.base+'/api/hosted/capabilities',{headers:{origin,'x-trial-id':ids[0]}})).json()).supportsImages).toBe(false);
    const on=await api({runner,images:true});expect((await (await fetch(on.base+'/api/hosted/capabilities',{headers:{origin,'x-trial-id':ids[0]}})).json()).supportsImages).toBe(true);
  });
  it('passes the validated image to the runner and reserves extra budget for it',async()=>{
    let seen:unknown;const failing:HostedRunner=async request=>{seen=request.hostedImage;throw new HostedError('controlled failure',502,'model_failed');};
    const charged=async(value:unknown)=>{const f=await api({runner:failing,images:true});await (await f.send('/api/hosted/inquiry/stream',value)).text();return JSON.parse(readFileSync(f.path,'utf8'));};
    const text=await charged(body);const image=await charged({...body,image:{data:pngHeader(1912,580)}});
    const sum=(l:{days:Record<string,{charged:number}>})=>Object.values(l.days).reduce((s,d)=>s+d.charged,0);
    expect(sum(image)).toBeGreaterThan(sum(text));expect(seen).toMatchObject({width:1912,height:580});
  });
  it('rejects an empty region search before reserving any budget or quota',async()=>{
    let calls=0;const runner:HostedRunner=async()=>{calls++;return {response};};
    const f=await api({runner,verificationRunner:runner,searchCostUsd:.01,images:true});
    const res=await f.send('/api/hosted/inquiry/stream',{...body,intent:'verify',quote:'第 4 页 · 所选区域',context:'未提取到辅助文字，请依据所选原图处理。',question:'',image:{data:pngHeader(100,100)}});
    expect(res.status).toBe(400);expect(calls).toBe(0);
    expect(Object.values(JSON.parse(readFileSync(f.path,'utf8')).days)).toEqual([]);
  });
  it('refuses to parse a large image body once the quota is exhausted',async()=>{
    let calls=0;const runner:HostedRunner=async()=>{calls++;return {response};};
    const f=await api({runner,images:true,limit:.001});
    const res=await f.send('/api/hosted/inquiry/stream',{...body,image:{data:'A'.repeat(200_000)}});
    expect(res.status).toBe(429);expect((await res.json()).code).toBe('global_quota_exhausted');expect(calls).toBe(0);
  });
  it('accepts a large image body only on the inquiry route when enabled',async()=>{
    const runner:HostedRunner=async()=>({response});const big='A'.repeat(200_000);
    const off=await api({runner});expect((await off.send('/api/hosted/inquiry/stream',{...body,image:{data:big}})).status).toBe(413);
    const on=await api({runner,images:true});expect((await on.send('/api/hosted/inquiry/stream',{...body,image:{data:big}})).status).toBe(400);
  });
});
