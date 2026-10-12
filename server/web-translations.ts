import {translationInterruption,timedOut} from "./translation-failure";
import { TranslationCache } from "./web-translation-cache";
import { join } from "node:path";
import { buildTranslationSource, copyWebTranslation, translationModelConfig, isTranslationModelConfig, TRANSLATION_LIMITS, TRANSLATION_CONTRACT_VERSION, TRANSLATION_QUALITY_VERSION, validUnitTranslation, validateTranslationBatch, type TranslationBatchResult } from '../src/lib/web-translation';
import { copyModelConfig, modelConfig } from '../src/lib/model-routing';
import { requestDeadline } from '../src/lib/request-deadline';
import { WebError } from './web-fetch';
import type { ReadingLibrary } from './reading-library';
import type { ProviderService } from './providers';
interface Request {qualityVersion?:number;operationId:string;roundId?:string;revisionId:string;sourceVersion:string;translationId:string;unitIds:string[];modelConfig?:unknown}
interface Job {key:string;controller:AbortController;promise:Promise<TranslationBatchResult>;created:number}
export class WebTranslations {
 private completed=new Map<string,TranslationBatchResult>();private readonly cache:TranslationCache;
 private jobs=new Map<string,Job>();private cancelled=new Map<string,{entryId:string;at:number}>();private active?:string;private rounds=new Map<string,number>();
 constructor(private library:ReadingLibrary,private provider:Pick<ProviderService,'translateWebBatch'>,private clock=Date.now,private roundMs:number=TRANSLATION_LIMITS.roundMs){this.cache=new TranslationCache(join(library.dir,"translation-results"));}
 cancel(entryId:string,operationId:string){if(typeof operationId!=='string'||!/^[-\w]{1,80}$/.test(operationId))throw new WebError('取消操作无效。');const j=this.jobs.get(operationId);if(j&&!j.key.startsWith(entryId+'|'))throw new WebError('翻译操作不属于此材料。','translation_unauthorized',403);if(this.cancelled.size>=256)this.cancelled.delete(this.cancelled.keys().next().value!);this.cancelled.set(operationId,{entryId,at:this.clock()});j?.controller.abort();return{cancelled:true};}
 async batch(entryId:string,input:unknown,signal?:AbortSignal):Promise<TranslationBatchResult>{
  const r=input as Request;if(!r||![r.operationId,r.translationId].every(id=>typeof id==='string'&&/^[-\w]{1,80}$/.test(id))||typeof r.revisionId!=='string'||typeof r.sourceVersion!=='string'||!Array.isArray(r.unitIds)||!r.unitIds.length||r.unitIds.length>TRANSLATION_LIMITS.units||new Set(r.unitIds).size!==r.unitIds.length||r.unitIds.some(id=>typeof id!=='string'))throw new WebError('翻译批次请求无效。','translation_invalid');
  for(const[id,c]of this.cancelled)if(this.clock()-c.at>TRANSLATION_LIMITS.roundMs)this.cancelled.delete(id);if(this.cancelled.has(r.operationId))throw new WebError(translationInterruption('cancelled').message,'translation_cancelled',408);
  if(r.qualityVersion!==undefined&&r.qualityVersion!==TRANSLATION_QUALITY_VERSION)throw new WebError('翻译质量版本已变化，请刷新后重试。','translation_quality',409);
  const config=r.modelConfig===undefined?translationModelConfig():copyModelConfig(r.modelConfig);if(!config||!isTranslationModelConfig(config))throw new WebError('翻译配置无效。','invalid_model_config');
  const entry=await this.library.get(entryId),d=entry.workspace.document;if(d.kind!=='web'||entry.revisionId!==r.revisionId||d.web.contentVersion!==r.sourceVersion)throw new WebError('原文版本已变化，请重新打开后翻译。','translation_version',409);
  const source=buildTranslationSource(d.markdown,d.web),map=new Map(source.units.map(u=>[u.id,u]));const units=r.unitIds.map(id=>map.get(id));if(units.some(u=>!u)||units.reduce((n,u)=>n+u!.text.length,0)>TRANSLATION_LIMITS.inputChars)throw new WebError('翻译单元不属于此原文或超过预算。','translation_unauthorized');
  const typed=units as NonNullable<typeof units[number]>[];
  const key=[entryId,TRANSLATION_CONTRACT_VERSION, TRANSLATION_QUALITY_VERSION,r.revisionId,r.sourceVersion,r.translationId,JSON.stringify(r.unitIds),JSON.stringify(config)].join('|');
  if(this.cancelled.has(r.operationId))throw new WebError(translationInterruption('cancelled').message,'translation_cancelled',408);const previous=this.jobs.get(r.operationId);if(previous){if(previous.key!==key)throw new WebError('操作标识已用于另一批次。','translation_operation_conflict',409);return previous.promise.then(result=>({...result,repairCount:0}));}
  const saved=copyWebTranslation((entry.workspace as unknown as {webTranslation?:unknown}).webTranslation,d.id,d.web.contentVersion,source);
  if(saved?.id===r.translationId&&typed.every(u=>validUnitTranslation(u,saved.units[u.id])))return{operationId:r.operationId,translationId:r.translationId,sourceVersion:r.sourceVersion,modelConfig:saved.modelConfig,units:Object.fromEntries(typed.map(u=>[u.id,saved.units[u.id]]))};
  const pending=typed.filter(u=>!saved||saved.id!==r.translationId||!validUnitTranslation(u,saved.units[u.id]));
  const memory=this.completed.get(key);if(memory){await this.cache.write(key,memory);return{...memory,operationId:r.operationId,repairCount:0};}
  const cached=await this.cache.read(key,typed,pending);if(cached){if(cached.translationId!==r.translationId||cached.sourceVersion!==r.sourceVersion||JSON.stringify(cached.modelConfig)!==JSON.stringify(config))throw new WebError('翻译缓存身份不匹配。','translation_cache',503);return{...cached,operationId:r.operationId,repairCount:0};}
  if(r.roundId!==undefined&&(typeof r.roundId!=='string'||!/^[-\w]{1,80}$/.test(r.roundId)))throw new WebError('翻译轮次无效。');const roundKey=entryId+'|'+(r.roundId??r.translationId);for(const[id,j]of this.jobs)if(this.clock()-j.created>TRANSLATION_LIMITS.roundMs&&!this.active)this.jobs.delete(id);
  if(this.active)throw new WebError('已有翻译批次处理中，请停止或等待。','translation_busy',409);
  if(this.jobs.size>=256||this.completed.size>=256)throw new WebError('翻译操作过多，请重启服务后续译。','translation_budget',429);
  for(const[id,at]of this.rounds)if(this.clock()-at>TRANSLATION_LIMITS.roundMs*2)this.rounds.delete(id);if(!this.rounds.has(roundKey)&&this.rounds.size>=256)throw new WebError('翻译轮次过多，请重启后继续。','translation_budget',429);const started=this.rounds.get(roundKey)??this.clock();this.rounds.set(roundKey,started);const remaining=Math.min(this.roundMs,TRANSLATION_LIMITS.roundMs)-(this.clock()-started);if(remaining<=0)throw new WebError(translationInterruption('round-timeout').message,'translation_round_timeout',408);
  const controller=new AbortController();const deadline=requestDeadline(Math.min(remaining,TRANSLATION_LIMITS.callMs),AbortSignal.any([controller.signal,...(signal?[signal]:[])]));this.active=r.operationId;
  const promise=(async()=>{try{const result=await deadline.wait(this.provider.translateWebBatch(pending,config,deadline.signal));deadline.check();if(!isTranslationModelConfig(result.modelConfig))throw new WebError("翻译返回的模型配置不匹配。","translation_model",502);validateTranslationBatch(pending,Object.entries(result.units).map(([id,text])=>({id,text})));const current=await this.library.get(entryId);deadline.check();if(current.revisionId!==r.revisionId||current.workspace.document.kind!=='web'||current.workspace.document.web.contentVersion!==r.sourceVersion)throw new WebError('翻译结果对应的原文已变化。','translation_version',409);const validated={...(result.repairCount?{repairCount:result.repairCount}:{}),operationId:r.operationId,translationId:r.translationId,sourceVersion:r.sourceVersion,modelConfig:result.modelConfig,units:{...(saved?.id===r.translationId?Object.fromEntries(typed.filter(u=>validUnitTranslation(u,saved.units[u.id])).map(u=>[u.id,saved.units[u.id]])):{}),...result.units}};this.completed.set(key,validated);await this.cache.write(key,validated);return validated;}finally{deadline.dispose();if(this.active===r.operationId)this.active=undefined;}})();
  const shared=promise.catch(error=>{
    this.jobs.delete(r.operationId);
    if(deadline.signal.aborted){
      let cause: import('./translation-failure').TranslationInterruption='connection';
      if(this.cancelled.has(r.operationId))cause='cancelled';
      else if(!signal?.aborted&&timedOut(deadline.signal.reason))cause=remaining<=TRANSLATION_LIMITS.callMs?'round-timeout':'batch-timeout';
      const failure=translationInterruption(cause);throw new WebError(failure.message,failure.code,408);
    }
    throw error;
  });
  this.jobs.set(r.operationId,{key,controller,promise:shared,created:this.clock()});return shared;
 }
}
