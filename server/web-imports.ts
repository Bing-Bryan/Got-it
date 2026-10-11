import { randomUUID } from 'node:crypto';
import type { WebImportJob } from '../src/lib/web-data';
import { extractWeb, type ExtractedWeb } from './web-extract';
import { WEB_LIMITS, WebError, webUrl } from './web-fetch';
import type { ReadingLibrary } from './reading-library';
import type { LibraryEntry } from '../src/lib/library-types';
interface Job { public:WebImportJob;url:string;controller:AbortController;expires:number;data?:ExtractedWeb;confirming?:boolean;creationKey?:string;committed?:LibraryEntry & {webImportCreated:boolean} }
export class WebImports {
 private jobs=new Map<string,Job>();
 constructor(private library:ReadingLibrary,private extractor:typeof extractWeb=extractWeb,private clock=Date.now, private deadlineMs=WEB_LIMITS.jobMs){}
 private cleanup(){for(const [id,j]of this.jobs){if(j.expires<this.clock()&&!j.confirming){j.controller.abort();delete j.data;delete j.public.preview;j.public.status='expired';j.public.progress='预览已过期，请重新读取。';if(j.expires+WEB_LIMITS.previewMs<this.clock())this.jobs.delete(id);}}}
 private get(id:string){this.cleanup();const j=this.jobs.get(id);if(!j)throw new WebError('读取作业不存在或服务已重启，请重新读取。','web_job_missing',404);return j;}
 status(id:string):WebImportJob{return structuredClone(this.get(id).public);}
 async start(input:unknown,operationId:unknown):Promise<WebImportJob>{
  this.cleanup();if(typeof operationId!=='string'||!/^[-\w]{1,80}$/.test(operationId))throw new WebError('读取操作标识无效。');const url=webUrl(input).href;
  const previous=this.jobs.get(operationId);if(previous){if(previous.url!==url)throw new WebError('读取操作标识已用于另一链接。','web_operation_conflict',409);return this.status(operationId);}
  if([...this.jobs.values()].some(j=>j.public.status==='reading'||j.confirming))throw new WebError('已有文章正在读取或待确认，请先完成或取消。','web_busy',409);
  for(const [id,j]of this.jobs)if(j.public.status==='ready'&&!j.confirming){this.cancel(id);j.public.progress='已由新的读取操作取代，请重新读取。';}
  if(this.jobs.size>=20)throw new WebError('读取操作过多，请稍后重试。','web_busy',409);
  const controller=new AbortController(),expires=this.clock()+WEB_LIMITS.previewMs;
  const j:Job={url,controller,expires,public:{operationId,status:'reading',progress:'读取文章正文…',expiresAt:new Date(expires).toISOString()}};
  this.jobs.set(operationId,j);setTimeout(()=>this.cleanup(),WEB_LIMITS.previewMs+1).unref();
  try{const existing=await this.library.findWeb(url);if(j.public.status!=='reading')return this.status(operationId);if(existing){j.public.status='existing';j.public.entryId=existing.id;j.public.progress='已保存此链接，直接打开本机版本。';}else void this.read(j);}catch(e){this.jobs.delete(operationId);throw e;}
  return this.status(operationId);
 }
 private async read(j:Job){
  const signal=AbortSignal.any([j.controller.signal,AbortSignal.timeout(Math.min(this.deadlineMs,WEB_LIMITS.jobMs))]);
  try{
   const data=await deadline(this.extractor(j.url,{signal,progress:progress=>{if(j.public.status==='reading')j.public.progress=progress;}}),signal);
   if(j.public.status!=='reading')return;signal.throwIfAborted();if(j.expires<this.clock()){this.cleanup();return;}
   j.data=data;j.public.status='ready';j.public.progress=data.workspace.document.kind==='web'&&data.workspace.document.web.media.some(m=>m.status!=='saved')?'预览就绪，部分静态内容未导入。':'图文预览就绪，等待确认。';j.public.preview={workspace:data.workspace,candidateId:randomUUID()};
  }catch(e){if(j.public.status!=='reading')return;j.public.status='failed';j.public.error=signal.aborted?'读取已超时，请重试。':e instanceof WebError?e.message:'文章读取失败，请稍后重试。';j.public.progress=j.public.error;delete j.data;}
 }
 cancel(id:string){const j=this.get(id);if(j.confirming)throw new WebError('正在保存，请等待确认结果。','web_committing',409);if(j.committed)throw new WebError('文章已加入，请打开保存版本。','web_committed',409);j.controller.abort();delete j.data;delete j.public.preview;j.public.status='cancelled';j.public.progress='已取消读取。';return this.status(id);}
 async confirm(id:string,candidateId:unknown,creationKey:unknown,allowPartial:unknown){
  const j=this.get(id);if(j.committed)return j.committed;
  if(j.public.status!=='ready'||!j.public.preview||!j.data||candidateId!==j.public.preview.candidateId)throw new WebError('预览无效、已取消或过期，请重新读取。','web_candidate_invalid',409);
  if(j.confirming)throw new WebError('正在保存，请稍后重试相同确认操作。','web_committing',409);
  if(typeof creationKey!=='string'||!/^[-\w:]{1,160}$/.test(creationKey)||(j.creationKey&&j.creationKey!==creationKey))throw new WebError('请使用同一次确认操作重试。','web_creation_conflict',409);
  if(j.data.workspace.document.kind==='web'&&j.data.workspace.document.web.media.some(m=>m.status!=='saved')&&allowPartial!==true)throw new WebError('部分内容未导入，请明确确认仅加入已获取内容。','web_partial',409);
  j.creationKey=creationKey;j.confirming=true;
  try{const entry=await this.library.addWeb(j.data.workspace,j.data.resources,creationKey,()=>{if(j.controller.signal.aborted||j.expires<this.clock())throw new WebError('预览已取消或过期。','web_candidate_invalid',409)});j.committed=entry;delete j.data;delete j.public.preview;j.public.status='existing';j.public.entryId=entry.id;j.public.progress='文章已保存到本机。';return entry;}
  finally{j.confirming=false;}
 }
 resource(id:string,resourceId:string){const j=this.get(id);if(j.public.status!=='ready'||!j.data||j.data.workspace.document.kind!=='web'||!j.data.workspace.document.web.media.some(m=>m.status==='saved'&&m.resourceId===resourceId))throw new WebError('预览资源不可用。','web_resource_unauthorized',404);const r=j.data.resources.get(resourceId);if(!r)throw new WebError('预览资源缺失。','web_resource_missing',404);return{bytes:r.bytes,mime:r.mime};}
}

function deadline<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{const stop=()=>reject(new WebError('读取已超时或停止。','web_stopped'));if(signal.aborted)return stop();signal.addEventListener('abort',stop,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});}
