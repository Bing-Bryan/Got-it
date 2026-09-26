// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { parseModelPage, readCodexModels } from './codex-models';
import { ProviderService } from './providers';
import { TEST_MODELS } from './test-support/model-catalog';
const spawnMock=vi.hoisted(()=>vi.fn());
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),spawn:spawnMock}));
afterEach(()=>vi.restoreAllMocks());
function fakeServer(reply:(request:any, child:any)=>void){
 const child:any=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
 child.kill=vi.fn(()=>{queueMicrotask(()=>child.emit('close',0));return true;});
 child.stdin.on('data',(data:Buffer)=>reply(JSON.parse(data.toString()),child));spawnMock.mockReturnValue(child);return child;
}
const send=(child:any,message:object)=>child.stdout.write(JSON.stringify(message)+'\n');
it('handshakes before paginating, ignores notifications, projects safe fields and kills its process',async()=>{
 const seen:any[]=[];const child=fakeServer((r,c)=>{
  seen.push(r);
  if(r.method==='initialize')send(c,{id:r.id,result:{}});
  if(r.method==='model/list'){
   send(c,{method:'notification',params:{secret:'not forwarded'}});
   send(c,{id:r.id,result:{data:[{...TEST_MODELS[r.params.cursor?4:3],secret:'never forwarded'}],nextCursor:r.params.cursor?null:'second'}});
  }
 });
 const models=await readCodexModels('fake');
 expect(seen.map(r=>r.method)).toEqual(['initialize','initialized','model/list','model/list']);
 expect(seen[3].params).toMatchObject({cursor:'second',includeHidden:false});
 expect(models.map(m=>m.model)).toEqual(['gpt-6-astra','gpt-5.5']);expect(JSON.stringify(models)).not.toContain('secret');expect(child.kill).toHaveBeenCalled();
});
it('rejects protocol errors, repeated cursors, oversized output and silence with cleanup',async()=>{
 for(const mode of ['error','cursor','large','silent']){
  const child=fakeServer((r,c)=>{
   if(mode==='silent')return;
   if(mode==='large'){c.stdout.write('x'.repeat(2*1024*1024+1));return;}
   if(r.method==='initialize')send(c,{id:r.id,result:{}});
   if(r.method==='model/list')send(c,mode==='error'?{id:r.id,error:{message:'private failure'}}:{id:r.id,result:{data:[TEST_MODELS[3]],nextCursor:'loop'}});
  });
  await expect(readCodexModels('fake',30)).rejects.toThrow();expect(child.kill).toHaveBeenCalled();
 }
});
it('filters hidden and malformed models and preserves individual supported efforts',()=>{
 const page=parseModelPage({data:[TEST_MODELS[4],{...TEST_MODELS[3],hidden:true},{model:'--unsafe'},null],nextCursor:null});
 expect(page.models).toHaveLength(1);expect(page.models[0].supportedReasoningEfforts.map(e=>e.reasoningEffort)).toEqual(['low','medium','high','xhigh']);
 expect(()=>parseModelPage({data:'broken'})).toThrow();
});
it('deduplicates in-flight queries, caches briefly, force refreshes, and fails closed without stale fallback',async()=>{
 const loader=vi.fn(async()=>[TEST_MODELS[3]]);const service=new ProviderService({modelCatalog:loader});
 await Promise.all([service.getModels(),service.getModels()]);expect(loader).toHaveBeenCalledTimes(1);
 await service.getModels();expect(loader).toHaveBeenCalledTimes(1);
 await service.getModels(true);expect(loader).toHaveBeenCalledTimes(2);
 loader.mockRejectedValueOnce(new Error('offline'));await expect(service.getModels(true)).rejects.toThrow('offline');
 await service.getModels();expect(loader).toHaveBeenCalledTimes(4);
});
it('rejects disappeared models and unsupported efforts before starting a model request',async()=>{
 const exec=vi.fn();const service=new ProviderService({modelCatalog:async()=>[TEST_MODELS[4]],execFileImpl:exec});
 const request={providerId:'codex' as const,intent:'explain' as const,quote:'CAGR',question:'Explain',context:'',documentTitle:'',history:[]};
 await expect(service.answer({...request,modelConfig:{model:'gpt-5.6-luna',reasoningEffort:'max'}})).rejects.toMatchObject({code:'model_config_unavailable'});
 await expect(service.answer({...request,modelConfig:{model:'gpt-5.5',reasoningEffort:'ultra'}})).rejects.toMatchObject({code:'model_config_unavailable'});
 expect(exec).not.toHaveBeenCalled();
});
