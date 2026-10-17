import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import type {Workspace} from '../src/types';
import type {WebImportJob} from '../src/lib/web-data';
import {safeXImageSourceUrl} from '../src/lib/web-data';
import {normalizeXArticleUrl} from '../src/lib/x-article-url';
import {parseXArticleCapture,extractXArticle} from './x-article-capture';
import {extractWeb,type ExtractedWeb} from './web-extract';
import {fetchWeb,WEB_LIMITS,WebError,type FetchedWeb,type WebBudget} from './web-fetch';
import {articleUrl,mediaUrl} from './web-sites';
import {validateStaticImage} from './web-media';
import {HostedError,utcDay} from './hosted-budget';
import {HostedResourceTickets} from './hosted-resource-tickets';
const MEMORY_LIMIT=384*1024*1024;
const OP_RESERVE=WEB_LIMITS.totalBytes;
const RETRY_RESERVE=3*WEB_LIMITS.imageBytes;
export function hostedOperationToken(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new HostedError('临时操作凭证无效',403,'operation_unauthorized');return value;}
export function hostedOperationId(value:unknown):string{if(typeof value!=='string'||!/^[-\w]{1,80}$/.test(value))throw new HostedError('操作标识无效');return value;}
function sameToken(a:string,b:string){return a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
interface HostedJob {owner:string;token:string;controller:AbortController;job:WebImportJob;expires:number;bytes:number;inputHash:string;data?:ExtractedWeb;retryTickets?:Record<string,string>;}
export type HostedImportJob=WebImportJob;
export interface HostedWebOptions {extractor?:typeof extractWeb;captureExtractor?:typeof extractXArticle;clock?:()=>number;deadlineMs?:number;memoryLimit?:number;fetcher?:typeof fetchWeb;}
export class HostedWebImports{
 private jobs=new Map<string,HostedJob>();private activeReservations=new Map<HostedJob,number>();private clock:()=>number;private extractor:typeof extractWeb;private captureExtractor:typeof extractXArticle;
 private networkDay='';private browsers=new Map<string,number>();private ips=new Map<string,number>();private retryActive=new Map<string,string>();
 constructor(private tickets:HostedResourceTickets,private options:HostedWebOptions={}){this.clock=options.clock??Date.now;this.extractor=options.extractor??extractWeb;this.captureExtractor=options.captureExtractor??extractXArticle;}
 get memoryBytes(){return [...this.jobs.values()].reduce((n,j)=>n+j.bytes,0)+[...this.activeReservations.values()].reduce((n,v)=>n+v,0)+this.retryActive.size*RETRY_RESERVE;}
 private key(owner:string,op:string){return owner+':'+hostedOperationId(op);}
 private cleanup(){for(const [key,j]of this.jobs)if(j.expires<=this.clock()){j.controller.abort();this.jobs.delete(key);}}
 private get(owner:string,op:string,token:string){this.cleanup();const j=this.jobs.get(this.key(owner,op));if(!j)throw new HostedError('读取作业不存在、已过期或服务已重启',404,'web_job_missing');if(!sameToken(j.token,hostedOperationToken(token)))throw new HostedError('操作不属于当前请求',403,'operation_unauthorized');return j;}
 private admit(owner:string,ip:string){const day=utcDay(this.clock());if(day!==this.networkDay){this.browsers.clear();this.ips.clear();this.networkDay=day;}if((this.browsers.get(owner)||0)>=30||(this.ips.get(ip)||0)>=60)throw new HostedError('今日网页读取次数已用完',429,'web_rate_limit');this.browsers.set(owner,(this.browsers.get(owner)||0)+1);this.ips.set(ip,(this.ips.get(ip)||0)+1);}
 async start(owner:string,ip:string,token:string,input:unknown,x=false){
  this.cleanup();hostedOperationToken(token);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new HostedError('网页读取请求无效');const r=input as Record<string,unknown>;
  if(Object.keys(r).some(k=>!['operationId','url',...(x?['capture']:[])].includes(k))||('url'in r)==('capture'in r))throw new HostedError('网页读取请求字段无效');
  const op=hostedOperationId(r.operationId),capture=x&&r.capture!==undefined?parseXArticleCapture(r.capture):undefined;
  const url=capture?.url??articleUrl(r.url).href;if(x&&!normalizeXArticleUrl(url))throw new HostedError('请提供有效的X文章或公开帖链接');
  const hash=createHash('sha256').update(JSON.stringify({url,capture})).digest('hex'),key=this.key(owner,op),previous=this.jobs.get(key);
  if(previous){this.get(owner,op,token);if(previous.inputHash!==hash)throw new HostedError('操作标识已用于另一材料',409,'web_operation_conflict');return this.status(owner,op,token);}
  if([...this.jobs.values()].some(j=>j.owner===owner&&['reading','ready'].includes(j.job.status)))throw new HostedError('请先完成或取消当前文章读取',409,'web_busy');
  if([...this.jobs.values()].filter(j=>j.job.status==='reading').length>=2||this.activeReservations.size>=2||this.jobs.size>=20||this.memoryBytes+OP_RESERVE>(this.options.memoryLimit??MEMORY_LIMIT))throw new HostedError('网页读取容量暂满，请稍后重试',429,'web_memory_limit');
  this.admit(owner,ip);const controller=new AbortController(),expires=this.clock()+WEB_LIMITS.previewMs;
  const j:HostedJob={owner,token,controller,expires,bytes:0,inputHash:hash,job:{operationId:op,status:'reading',progress:'读取文章正文…',expiresAt:new Date(expires).toISOString()}};
  this.jobs.set(key,j);this.activeReservations.set(j,OP_RESERVE);const timer=setTimeout(()=>this.cleanup(),WEB_LIMITS.previewMs+10);timer.unref();
  void this.read(j,url,capture);return this.status(owner,op,token);
 }
 private async read(j:HostedJob,url:string,capture:ReturnType<typeof parseXArticleCapture>|undefined){
  const signal=AbortSignal.any([j.controller.signal,AbortSignal.timeout(Math.min(this.options.deadlineMs??WEB_LIMITS.jobMs,WEB_LIMITS.jobMs))]);
  const fetcher=(raw:string,maxBytes:number,budget:WebBudget)=> (this.options.fetcher??fetchWeb)(raw,{signal,maxBytes,budget,disableProxy:true,resolver:host=>lookup(host,{all:true}),validateUrl:maxBytes===WEB_LIMITS.htmlBytes?articleUrl:mediaUrl});
  try{
   const args={signal,fetcher,progress:(progress:string)=>{if(j.job.status==='reading')j.job.progress=progress;}};
   const extracting=capture?this.captureExtractor(capture,args):this.extractor(url,args);
   void extracting.then(()=>this.activeReservations.delete(j),()=>this.activeReservations.delete(j));
   const data=await bounded(extracting,signal);signal.throwIfAborted();
   if(j.job.status!=='reading'||j.expires<=this.clock())return;
   data.workspace.activeProviderId='deepseek';const doc=data.workspace.document;if(doc.kind!=='web')throw new HostedError('文章提取结果无效',502);
   let bytes=Buffer.byteLength(doc.markdown)+Buffer.byteLength(JSON.stringify(doc.web));
   for(const [id,image]of data.resources){if(createHash('sha256').update(image.bytes).digest('hex')!==id)throw new HostedError('图片完整性校验失败',502);bytes+=image.bytes.length;}
   if(bytes>OP_RESERVE||this.memoryBytes-j.bytes+bytes>(this.options.memoryLimit??MEMORY_LIMIT))throw new HostedError('文章资源超过内存容量限制',413,'web_memory_limit');
   const tickets:Record<string,string>={};for(const media of doc.web.media)if(media.kind==='image'&&media.status!=='unsupported'&&media.sourceUrl)tickets[media.id]=this.tickets.sign({v:1,documentId:doc.id,contentVersion:doc.web.contentVersion,mediaId:media.id,sourceUrl:media.sourceUrl,extractorVersion:doc.web.extractorVersion});
   j.bytes=bytes;j.data=data;j.retryTickets=tickets;j.job.status='ready';j.job.progress='图文预览就绪，准备加入当前浏览器。';j.job.preview={workspace:data.workspace,candidateId:randomUUID()};
  }catch(error){if(j.job.status!=='reading')return;j.bytes=0;delete j.data;delete j.retryTickets;j.job.status='failed';j.job.error=signal.aborted?'读取已停止或超时，请重试':error instanceof WebError||error instanceof HostedError?error.message:'文章读取失败，请稍后重试';j.job.progress=j.job.error;}
 }
 status(owner:string,op:string,token:string):HostedImportJob{const j=this.get(owner,op,token);return structuredClone({...j.job,...(j.job.preview?{preview:{...j.job.preview,retryTickets:j.retryTickets??{}}}:{})});}
 cancel(owner:string,op:string,token:string){const j=this.get(owner,op,token);j.controller.abort();delete j.data;delete j.retryTickets;delete j.job.preview;j.bytes=0;j.job.status='cancelled';j.job.progress='已取消读取';return this.status(owner,op,token);}
 release(owner:string,op:string,token:string){const j=this.get(owner,op,token);j.controller.abort();this.jobs.delete(this.key(owner,op));return {released:true};}
 resource(owner:string,op:string,token:string,id:string){const j=this.get(owner,op,token);if(j.job.status!=='ready'||!j.data||j.data.workspace.document.kind!=='web'||!j.data.workspace.document.web.media.some(m=>m.status==='saved'&&m.resourceId===id))throw new HostedError('预览图片不可用',404,'web_resource_missing');const r=j.data.resources.get(id);if(!r)throw new HostedError('预览图片不存在',404);return r;}
 async retry(owner:string,ip:string,token:string,input:unknown,parent:AbortSignal){
  hostedOperationToken(token);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['operationId','ticket'].includes(k)))throw new HostedError('图片重试请求无效');
  const r=input as {operationId:string;ticket:string},key=this.key(owner,hostedOperationId(r.operationId)),ticket=this.tickets.verify(r.ticket);
  if(this.retryActive.has(key)||this.retryActive.size>=2||this.memoryBytes+RETRY_RESERVE>(this.options.memoryLimit??MEMORY_LIMIT))throw new HostedError('已有图片正在读取，请稍后重试',409,'web_busy');
  this.admit(owner,ip);this.retryActive.set(key,token);
  try{
   const signal=AbortSignal.any([parent,AbortSignal.timeout(30_000)]),validate=(url:string)=>{if(ticket.extractorVersion.startsWith('x-')&&!safeXImageSourceUrl(url))throw new HostedError('图片超出原公开来源范围',403);return mediaUrl(url);};
   const fetched=await bounded((this.options.fetcher??fetchWeb)(validate(ticket.sourceUrl).href,{signal,maxBytes:WEB_LIMITS.imageBytes,budget:{requests:0,bytes:0},disableProxy:true,resolver:host=>lookup(host,{all:true}),validateUrl:validate}),signal);validate(fetched.url);signal.throwIfAborted();
   const image=await validateStaticImage(fetched.bytes);signal.throwIfAborted();if(fetched.type.split(';')[0].trim()!==image.mime)throw new HostedError('图片格式与响应类型不一致',502);
   const id=createHash('sha256').update(image.bytes).digest('hex');return {documentId:ticket.documentId,contentVersion:ticket.contentVersion,media:{id:ticket.mediaId,kind:'image',status:'saved',resourceId:id,mime:image.mime,bytes:image.bytes.length,width:image.width,height:image.height,sourceUrl:ticket.sourceUrl},resource:{id,type:image.mime,base64:image.bytes.toString('base64')}};
  }finally{this.retryActive.delete(key);}
 }
}
export function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{const stop=()=>{clean();reject(signal.reason);};const clean=()=>signal.removeEventListener('abort',stop);signal.addEventListener('abort',stop,{once:true});promise.then(v=>{clean();if(signal.aborted)reject(signal.reason);else resolve(v);},e=>{clean();reject(e);});if(signal.aborted)stop();});}
