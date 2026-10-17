import {createHash,timingSafeEqual} from 'node:crypto';
import {requestDeadline} from '../src/lib/request-deadline';
import {translationStructure,validateTranslationBatch,placeholderRepairUnits,TRANSLATION_LIMITS,TRANSLATION_QUALITY_VERSION,type TranslationUnit,type TranslationBatchResult} from '../src/lib/web-translation';
import {WEB_TRANSLATION_INSTRUCTIONS} from './prompt-materials';
import {createHostedJsonModel} from './hosted-model';
import {HostedBudget,HostedError} from './hosted-budget';
import {hostedOperationId,hostedOperationToken} from './hosted-web-imports';
export const HOSTED_TRANSLATION_LIMITS={input:48000,output:8000,callMs:60_000};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
interface TranslationInput {qualityVersion:number;operationId:string;roundId?:string;sourceVersion:string;translationId:string;units:TranslationUnit[];}
export function parseHostedTranslation(input:unknown):TranslationInput{
 if(!record(input)||Object.keys(input).some(k=>!['qualityVersion','operationId','roundId','sourceVersion','translationId','units'].includes(k))||input.qualityVersion!==TRANSLATION_QUALITY_VERSION||typeof input.sourceVersion!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceVersion)||!Array.isArray(input.units)||!input.units.length||input.units.length>TRANSLATION_LIMITS.units)throw new HostedError('翻译批次格式或版本无效',400,'translation_invalid');
 hostedOperationId(input.operationId);hostedOperationId(input.translationId);if(input.roundId!==undefined)hostedOperationId(input.roundId);
 let chars=0;const ids=new Set<string>();
 for(const u of input.units){
  if(!record(u)||Object.keys(u).some(k=>!['id','blockId','text','structureContext'].includes(k))||typeof u.id!=='string'||!/^[-\w]{1,100}$/.test(u.id)||typeof u.blockId!=='string'||!/^[-\w]{1,100}$/.test(u.blockId)||ids.has(u.id)||typeof u.text!=='string'||!u.text.trim()||u.text.length>TRANSLATION_LIMITS.unitChars)throw new HostedError('翻译单元无效',400,'translation_invalid');
  ids.add(u.id);chars+=u.text.length;
  if(u.structureContext!==undefined){const ctx=u.structureContext as Record<string,unknown>;if(!record(u.structureContext)||Object.keys(u.structureContext).some(k=>!['before','after'].includes(k))||!['before','after'].every(k=>Array.isArray(ctx[k])&&(ctx[k] as unknown[]).length<=512&&(ctx[k] as unknown[]).every(t=>typeof t==='string'&&/^\[GOTIT_(OPEN|CLOSE|KEEP)_\d+\]$/.test(t))))throw new HostedError('翻译结构上下文无效',400,'translation_invalid');}
 }
 if(chars>TRANSLATION_LIMITS.inputChars)throw new HostedError('翻译批次超过输入上限',413,'translation_budget');
 return input as unknown as TranslationInput;
}
export function hostedTranslationPrompt(units:TranslationUnit[],repair=false){return WEB_TRANSLATION_INSTRUCTIONS+(repair?'上次这些项未通过排版校验。仅重新翻译所列项，严格保留structure.tokens、pairs和parents，不要输出其他项。\n':'')+JSON.stringify(units.map(u=>({id:u.id,text:u.text,structure:translationStructure(u)})));}
export type HostedTranslationModel=ReturnType<typeof createHostedJsonModel>;
interface Active {token:string;hash:string;controller:AbortController;promise:Promise<TranslationBatchResult>;created:number;}
interface Terminal {token:string;hash?:string;payloadHash?:string;status:'completed'|'cancelled'|'failed';created:number;result?:TranslationBatchResult}
export class HostedTranslations{
 private active=new Map<string,Active>();private terminal=new Map<string,Terminal>();private rounds=new Map<string,number>();
 constructor(private budget:HostedBudget,private model:HostedTranslationModel,private clock=Date.now,private timeoutMs=HOSTED_TRANSLATION_LIMITS.callMs){}
 private key(owner:string,op:string){return owner+':'+hostedOperationId(op);}
 private cleanup(){for(const [key,v]of this.terminal)if(this.clock()-v.created>TRANSLATION_LIMITS.roundMs)this.terminal.delete(key);for(const[key,time]of this.rounds)if(this.clock()-time>TRANSLATION_LIMITS.roundMs*2)this.rounds.delete(key);}
 cancel(owner:string,op:string,token:string){hostedOperationToken(token);this.cleanup();const key=this.key(owner,op),job=this.active.get(key),end=this.terminal.get(key);if(job&&!same(job.token,token)||end&&!same(end.token,token))throw new HostedError('翻译操作不属于当前请求',403,'operation_unauthorized');job?.controller.abort(new Error('用户停止翻译'));if(this.terminal.size>=256)this.terminal.delete(this.terminal.keys().next().value!);this.terminal.set(key,{token,status:'cancelled',created:this.clock()});return {cancelled:true};}
 async batch(owner:string,ip:string,token:string,input:unknown,parent:AbortSignal):Promise<TranslationBatchResult>{
  hostedOperationToken(token);this.cleanup();const r=parseHostedTranslation(input),key=this.key(owner,r.operationId),hash=createHash('sha256').update(JSON.stringify(r)).digest('hex'),payloadHash=createHash('sha256').update(JSON.stringify({...r,roundId:undefined})).digest('hex'),existing=this.active.get(key),end=this.terminal.get(key);
  if(end){
   // A lost response may be retried with the same batch. The operation token is memory-only in the browser,
   // so a reload presents a new one; ownership (the trial id, already this owner's credential) and the exact
   // batch payload are the stable identity here. Return the completed result without another model call or
   // charge; cancelled/failed still require the token, and a different batch conflicts.
   if(end.status==='completed'&&end.result&&end.payloadHash===payloadHash)return {...end.result,repairCount:0};
   if(!same(end.token,token))throw new HostedError('翻译操作不属于当前请求',403);
   throw new HostedError(end.status==='cancelled'?'翻译已停止，已有译文保留，可主动续译':end.status==='failed'?'前次批次已失败，请重新发起未完成部分':'该批次已完成，请使用新操作标识继续未保存部分',409,end.status==='cancelled'?'translation_cancelled':'translation_completed');}
  if(existing){if(!same(existing.token,token))throw new HostedError('翻译操作不属于当前请求',403);if(existing.hash!==hash)throw new HostedError('翻译操作标识已用于其他批次',409,'translation_operation_conflict');return existing.promise;}
  if([...this.active.keys()].some(k=>k.startsWith(owner+':'))||this.active.size>=2||this.rounds.size>=256)throw new HostedError('已有翻译批次处理中，请先停止或等待',409,'translation_busy');
  const round=owner+':'+(r.roundId??r.translationId),started=this.rounds.get(round)??this.clock();this.rounds.set(round,started);const remaining=TRANSLATION_LIMITS.roundMs-(this.clock()-started);if(remaining<=0)throw new HostedError('本轮翻译已超时，已有译文保留，可主动续译',408,'translation_round_timeout');
  const controller=new AbortController(),deadline=requestDeadline(Math.min(this.timeoutMs,remaining,HOSTED_TRANSLATION_LIMITS.callMs),AbortSignal.any([parent,controller.signal]));
  let completed=false,output:TranslationBatchResult|undefined;
  const promise=(async()=>{
   try{
    const run=async(units:TranslationUnit[],repair=false)=>{
     deadline.check();const prompt=hostedTranslationPrompt(units,repair),inputTokens=Buffer.byteLength(prompt,'utf8')+128;if(inputTokens>HOSTED_TRANSLATION_LIMITS.input)throw new HostedError('翻译批次完整上下文超限，请缩小批次',413,'translation_budget');
     const settle=this.budget.reserve(owner,ip,0,{input:inputTokens,output:HOSTED_TRANSLATION_LIMITS.output});
     try{const result=await deadline.wait(this.model(prompt,deadline.signal,()=>{}));deadline.check();settle(result.usage);if(!record(result.data)||Object.keys(result.data).some(k=>k!=='translations')||!record(result.data.translations))throw new HostedError('翻译结构化输出无效，已有译文保留',502,'translation_invalid');return Object.entries(result.data.translations).map(([id,text])=>({id,text}));}
     finally{settle();}
    };
    let rows=await run(r.units),repairCount=0;const failed=placeholderRepairUnits(r.units,rows);
    if(failed.length){const replacement=await run(failed,true);try{validateTranslationBatch(failed,replacement);}catch{throw new HostedError('本批译文排版或内容校验失败，已有译文保留，可主动续译',502,'translation_invalid');}const map=new Map(replacement.map(row=>[row.id,row]));rows=rows.map(row=>map.get(row.id)??row);repairCount=failed.length;}
    let units:Record<string,string>;try{units=validateTranslationBatch(r.units,rows);}catch{throw new HostedError('本批译文排版或内容校验失败，已有译文保留，可主动续译',502,'translation_invalid');}
    deadline.check();completed=true;output={operationId:r.operationId,translationId:r.translationId,sourceVersion:r.sourceVersion,modelConfig:{model:'deepseek-flash',reasoningEffort:'none'},providerId:'deepseek' as const,units,...(repairCount?{repairCount}:{})};return output;
   }catch(error){if(deadline.signal.aborted)throw new HostedError('翻译已停止或超时，已有译文保留，可主动续译',408,'translation_cancelled');if(error instanceof HostedError)throw error;throw new HostedError('翻译失败，已有译文保留，可主动续译',502,'translation_failed');}
   finally{deadline.dispose();this.active.delete(key);if(!this.terminal.has(key)){if(this.terminal.size>=256)this.terminal.delete(this.terminal.keys().next().value!);this.terminal.set(key,{token,hash,payloadHash,status:completed?'completed':'failed',created:this.clock(),...(output?{result:output}:{})});}}
  })();
  this.active.set(key,{token,hash,controller,promise,created:this.clock()});return promise;
 }
}
export function createHostedTranslationModel(apiKey:string){return createHostedJsonModel(apiKey,{input:HOSTED_TRANSLATION_LIMITS.input,output:HOSTED_TRANSLATION_LIMITS.output});}
