import {createHash} from 'node:crypto';
import {ReadingLibrary} from './reading-library';
import {fetchWeb,WEB_LIMITS,WebError} from './web-fetch';
import {mediaUrl} from './web-sites';
import {validateStaticImage} from './web-media';
import {safeXImageSourceUrl,WEB_MEDIA_ID} from '../src/lib/web-data';
/** Explicit one-image fetch. No page extraction, credentials, tools, or automatic retries. */
export class WebMediaRetries {
 private active=new Map<string,Promise<Awaited<ReturnType<ReadingLibrary['get']>>>>();
 constructor(private library:ReadingLibrary,private fetcher:typeof fetchWeb=fetchWeb){}
 retry(entryId:string,revisionId:unknown,mediaId:string,signal:AbortSignal){
  if(typeof revisionId!=='string'||! /^[a-f0-9-]{36}$/.test(revisionId)||!WEB_MEDIA_ID.test(mediaId))return Promise.reject(new WebError('图片或版本标识无效。','web_media_invalid'));
  const key=JSON.stringify([entryId,revisionId,mediaId]),existing=this.active.get(key);if(existing)return existing;
  if(this.active.size>=2)return Promise.reject(new WebError('已有图片正在读取，请稍后重试。','web_media_busy',409));
  const run=this.run(entryId,revisionId,mediaId,signal).finally(()=>this.active.delete(key));this.active.set(key,run);return run;
 }
 private async run(entryId:string,revisionId:string,mediaId:string,parent:AbortSignal){
  const signal=AbortSignal.any([parent,AbortSignal.timeout(30000)]);signal.throwIfAborted();
  const entry=await this.library.get(entryId),doc=entry.workspace.document;
  if(entry.revisionId!==revisionId)throw new WebError('旧版本只读，请回到当前材料后重试图片。','web_media_revision',409);
  if(doc.kind!=='web')throw new WebError('该材料没有网页图片。','web_media_missing',404);
  const media=doc.web.media.find(m=>m.id===mediaId);
  if(!media||media.kind!=='image'||media.status==='unsupported'||!media.sourceUrl)throw new WebError('没有可重试的公开图片地址，请在原网页查看。','web_media_unavailable',409);
  if(media.status==='saved'){try{await this.library.webResources.read(media);return entry;}catch(error){if(!(error instanceof WebError)||!['web_resource_missing','web_resource_corrupt'].includes(error.code))throw error;}}
  const x=doc.web.extractorVersion.startsWith('x-');
  const validate=(raw:string)=>{if(x&&!safeXImageSourceUrl(raw))throw new WebError('图片地址不在原有公开来源范围。','web_resource_host');return mediaUrl(raw);};
  const url=validate(media.sourceUrl).href;
  const fetched=await this.fetcher(url,{signal,maxBytes:WEB_LIMITS.imageBytes,budget:{requests:0,bytes:0},validateUrl:validate});validate(fetched.url);signal.throwIfAborted();
  const image=await validateStaticImage(fetched.bytes);signal.throwIfAborted();
  if(fetched.type.split(';')[0].trim()!==image.mime)throw new WebError('图片响应类型与实际格式不一致。','web_image');
  return this.library.promoteWebMedia(entryId,revisionId,mediaId,media.sourceUrl,createHash('sha256').update(image.bytes).digest('hex'),image,signal);
 }
}
