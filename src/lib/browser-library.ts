import {cancelHostedOperation,hostedOperationFetch,hostedOperationRequest,releaseHostedOperation} from './hosted-web-client';
import {safeWebUrl,type WebImportJob} from './web-data';
import {normalizeXArticleUrl,xArticleIdentity} from './x-article-url';
import {TRANSLATION_QUALITY_VERSION} from './web-translation';
import {copyOutline,type PdfOutline} from './pdf-outline';
import {documentTranslationSource,documentTranslationVersion} from './document-translation';
import {loadPdfTranslationSource} from './pdf-translation-loader';
import {HOSTED_IMAGE_MAX_BYTES,copyOcr,copyPdfLocation} from './pdf-data';
import type { Anchor } from '../types';
import type { Workspace } from '../types';
import type { LibraryEntry, ReadingPosition } from './library-types';
import { restoreWorkspace, sanitizeWorkspace } from './storage';
import { createInitialWorkspace } from '../sample';
import { bookmarkPosition, bookmarkQuote, bookmarkSearchScore, type ReadingBookmark, type BookmarkCreate } from './bookmark-types';
import { canonical, readingKey, type RecoveryRecord, type ReadingDraft } from './reading-recovery';

const DB='got-it.browser-library.v1';
type Resource={id:string;bytes:Uint8Array;type:string};
type State={id:'library';webRetryTickets?:Record<string,Record<string,string>>;entries:LibraryEntry[];activeId:string|null;bookmarks:ReadingBookmark[];bookmarkRevision:number;resources:Resource[];recoveries:RecoveryRecord[];sampleImages:Record<string,{url:string;id:string}[]>;outlines:Record<string,PdfOutline>};
const empty=():State=>({id:'library',entries:[],activeId:null,bookmarks:[],bookmarkRevision:0,resources:[],recoveries:[],sampleImages:{},outlines:{}});
export class BrowserStorageError extends Error { constructor(message:string,public status=400){super(message);} }
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('state',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('浏览器阅读库无法打开，请检查存储权限。'));r.onblocked=()=>reject(new Error('其他标签正在更新阅读库，请关闭后重试。'));});}
/** Resolve only on transaction completion, including browser quota/commit failures. */
async function transaction<T>(write:boolean,action:(state:State)=>T):Promise<T>{const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('state',write?'readwrite':'readonly'),store=tx.objectStore('state');let value:T;let failure:unknown;const r=store.get('library');r.onsuccess=()=>{try{const state:State=r.result??empty();value=action(state);if(write)store.put(state);}catch(e){failure=e;tx.abort();}};tx.oncomplete=()=>{database.close();resolve(value);};tx.onabort=tx.onerror=()=>{database.close();reject(failure??new BrowserStorageError(tx.error?.name==='QuotaExceededError'?'浏览器存储空间不足，当前草稿已保留，请释放空间或备份后重试。':'浏览器保存失败，当前草稿已保留，请重试。'));};});}
export async function sha256(bytes:Uint8Array|string){const input=typeof bytes==='string'?new TextEncoder().encode(bytes):bytes;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(input)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
function safeWorkspace(value:Workspace){const w=restoreWorkspace(sanitizeWorkspace(value));if(!w)throw new Error('阅读数据不完整');return {...w,activeProviderId:'deepseek' as const};}
function position(value:ReadingPosition|undefined):ReadingPosition{return {ratio:Number.isFinite(value?.ratio)?Math.min(1,Math.max(0,value!.ratio)):0,...(value?.blockId?{blockId:String(value.blockId),offset:Number(value.offset)||0}:{}),...(value?.pdfPage?{pdfPage:Number(value.pdfPage),pdfZoom:Number(value.pdfZoom)||0,pdfLeft:Number(value.pdfLeft)||0}:{})};}
function safeAnchor(a:Anchor):Anchor{
 if(!a||typeof a.documentId!=='string'||typeof a.blockId!=='string'||typeof a.quote!=='string'||typeof a.prefix!=='string'||typeof a.suffix!=='string'||!Number.isSafeInteger(a.start)||!Number.isSafeInteger(a.end)||a.start<0||a.end<a.start)throw new Error('收藏锚点无效');
 const pdf=a.pdf?copyPdfLocation(a.pdf):undefined;if(a.pdf&&!pdf)throw new Error('收藏 PDF 位置无效');
 return {headingPath:Array.isArray(a.headingPath)?a.headingPath.filter(x=>typeof x==='string'):[],matchStatus:a.matchStatus==='matched'?'matched':'needs-relink',documentId:a.documentId,blockId:a.blockId,start:a.start,end:a.end,quote:a.quote,prefix:a.prefix,suffix:a.suffix,...(pdf?{pdf}:{}),...(a.textVersion===2?{textVersion:2 as const}:{}),...(a.scope==='document'?{scope:'document' as const}:{}),...(a.segments?{segments:a.segments.map(safeAnchor)}:{})};
}
function safeEntry(e:LibraryEntry):LibraryEntry{
 if(!e||typeof e.id!=='string'||!e.id||!Number.isSafeInteger(e.version)||e.version<1||typeof e.revisionId!=='string'||!Array.isArray(e.history))throw new Error('备份条目无效');
 return {id:e.id,version:e.version,revisionId:e.revisionId,source:null,workspace:safeWorkspace(e.workspace),position:position(e.position),history:e.history.map(h=>({id:String(h.id),savedAt:String(h.savedAt),workspace:safeWorkspace(h.workspace),position:position(h.position)})),updatedAt:String(e.updatedAt),lastOpenedAt:String(e.lastOpenedAt),creationKey:String(e.creationKey)};
}
function safeRecovery(r:RecoveryRecord):RecoveryRecord{
 const snap=(v:RecoveryRecord['disk'])=>v?{workspace:safeWorkspace(v.workspace),position:position(v.position),revisionId:String(v.revisionId),version:Number(v.version)}:null;
 return {id:String(r.id),entryId:String(r.entryId),createdAt:String(r.createdAt),state:r.state==='resolved'?'resolved':'pending',reason:'changed',draft:{entryId:String(r.draft.entryId),version:Number(r.draft.version),revisionId:String(r.draft.revisionId),workspace:safeWorkspace(r.draft.workspace),position:position(r.draft.position)},disk:snap(r.disk),previous:r.previous.map(v=>snap(v)!),...(r.resultEntryId?{resultEntryId:String(r.resultEntryId)}:{}),...(r.choice==='draft'||r.choice==='disk'?{choice:r.choice}:{}),...(r.acknowledgedAt?{acknowledgedAt:String(r.acknowledgedAt)}:{})};
}
function requiredResources(w:Workspace){return [...(w.document.kind==='web'?w.document.web.media.filter(m=>m.status==='saved').map(m=>m.resourceId!):[]),...(w.document.kind==='pdf'?[w.document.pdf.resourceId]:[]),...w.inquiries.flatMap(i=>[i.anchor.pdf?.cropId,i.anchor.pdf?.ocrId].filter((x):x is string=>!!x))];}
function assertResources(s:State,w:Workspace){for(const id of requiredResources(w))if(!s.resources.some(r=>r.id===id))throw new Error('阅读记录依赖的图片、PDF 或识别资源缺失，尚未保存。');if(w.document.kind==='web')for(const media of w.document.web.media.filter(m=>m.status==='saved')){const r=s.resources.find(r=>r.id===media.resourceId)!;if(r.type!==media.mime||r.bytes.length!==media.bytes)throw new Error('网页资源格式或大小与原文不匹配。');}}
const localWebJobs=new Map<string,WebImportJob>();
const cancelledWebJobs=new Set<string>();
function webIdentity(url:string){return xArticleIdentity(url)??new URL(url).href.split('#')[0];}
function findWeb(s:State,url:string){return s.entries.find(e=>e.workspace.document.kind==='web'&&[e.workspace.document.web.originalUrl,e.workspace.document.web.finalUrl].some(saved=>webIdentity(saved)===webIdentity(url)));}
function copyRetryTickets(value:unknown,mediaIds:string[]){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('图片重试凭据格式无效');
 return Object.fromEntries(Object.entries(value).map(([id,ticket])=>{if(!mediaIds.includes(id)||typeof ticket!=='string'||!ticket||ticket.length>16384)throw new Error('图片重试凭据无效');return [id,ticket];}));
}
async function retryWebMedia(id:string,mediaId:string,revisionId:unknown){
 const original=await transaction(false,s=>{const e=entry(s,id),doc=e.workspace.document;if(e.revisionId!==revisionId||doc.kind!=='web')throw new Error('原文版本已变化，图片未写入其他材料。');const media=doc.web.media.find(m=>m.id===mediaId);if(!media||media.kind!=='image'||media.status==='unsupported'||!media.sourceUrl)throw new Error('没有可重试的公开图片地址，请在原网页查看。');const stored=media.resourceId?s.resources.find(r=>r.id===media.resourceId):undefined;return {e,doc,media,stored,ticket:s.webRetryTickets?.[doc.id]?.[mediaId]};});
 if(original.media.status==='saved'&&original.stored&&original.stored.type===original.media.mime&&original.stored.bytes.length===original.media.bytes&&await sha256(original.stored.bytes)===original.media.resourceId)return original.e;
 if(!original.ticket)throw new Error('这张图片缺少可验证的重试凭据，请重新导入原文章；已保存内容仍保留。');
 const operationId=crypto.randomUUID();
 try{
  const result=await hostedOperationRequest<{documentId:string;contentVersion:string;media:import('./web-data').WebMedia;resource:{id:string;type:string;base64:string}}>('/web-media/retry',operationId,{operationId,ticket:original.ticket});
  const {media,resource}=result;
  if(result.documentId!==original.doc.id||result.contentVersion!==original.doc.web.contentVersion||media.id!==mediaId||media.kind!=='image'||media.status!=='saved'||media.sourceUrl!==original.media.sourceUrl||media.resourceId!==resource.id||media.mime!==resource.type||typeof resource.base64!=='string'||resource.base64.length>45*1024*1024)throw new Error('图片恢复结果与原文不匹配');
  const bytes=Uint8Array.from(atob(resource.base64),c=>c.charCodeAt(0));if(bytes.length!==media.bytes||await sha256(bytes)!==resource.id)throw new Error('图片恢复资源完整性校验失败');
  return await transaction(true,s=>{const e=entry(s,id),doc=e.workspace.document;if(e.version!==original.e.version||e.revisionId!==revisionId||doc.kind!=='web'||canonical(doc)!==canonical(original.doc))throw new BrowserStorageError('阅读材料已变化，图片未写入其他材料。',409);
   const previous=original.media,next={...media,...(previous.status==='missing'?{legacyMissing:previous.legacyMissing??{reason:previous.reason??'未导入',linked:true}}:previous.legacyMissing?{legacyMissing:previous.legacyMissing}:{})};
   const workspace=safeWorkspace({...e.workspace,document:{...doc,web:{...doc.web,media:doc.web.media.map(m=>m.id===mediaId?next:m)}}});
   if(workspace.document.kind!=='web'||workspace.document.web.media.reduce((n,m)=>n+(m.bytes??0),0)>128*1024*1024)throw new Error('图片或正文媒体容量无效');
   const old=s.resources.findIndex(r=>r.id===resource.id);if(old>=0)s.resources[old]={id:resource.id,type:resource.type,bytes};else s.resources.push({id:resource.id,type:resource.type,bytes});assertResources(s,workspace);e.workspace=workspace;e.version++;e.updatedAt=new Date().toISOString();return e;
  });
 }finally{releaseHostedOperation(operationId);}
}
async function webRequest(path:string,parts:string[],input:Record<string,any>,body:unknown){
 if(parts.length===1){
  const id=input.operationId;if(typeof id!=='string'||!/^[-\w]{1,80}$/.test(id))throw new Error('读取操作标识无效');
  const raw=input.capture?.url??input.url,safe=safeWebUrl(raw);if(!safe)throw new Error('请输入无登录凭据的公开文章链接');const url=normalizeXArticleUrl(safe)??safe;
  cancelledWebJobs.delete(id);
  const existing=await transaction(false,s=>findWeb(s,url));
  if(existing){const job:WebImportJob={operationId:id,status:'existing',entryId:existing.id,progress:'已保存此链接，直接打开当前浏览器副本。'};localWebJobs.set(id,job);return job;}
  return hostedOperationRequest<WebImportJob>(path,id,input);
 }
 const id=parts[1];
 if(parts[2]==='cancel'){
  cancelledWebJobs.add(id);cancelHostedOperation(id);
  if(localWebJobs.has(id)){localWebJobs.delete(id);return {operationId:id,status:'cancelled',progress:'已取消读取。'};}
  return hostedOperationRequest(path,id,{});
 }
 const local=localWebJobs.get(id);if(local){if(parts[2]==='confirm'&&local.entryId)return transaction(false,s=>({...entry(s,local.entryId!),webImportCreated:false}));return local;}
 if(parts[2]==='confirm'){
  if(typeof input.creationKey!=='string'||!/^[-\w:]{1,160}$/.test(input.creationKey))throw new Error('保存操作标识无效');
  if(cancelledWebJobs.has(id))throw new Error('读取已取消，请重新读取');
  const before=await hostedOperationRequest<WebImportJob>(`/web-imports/${id}`,id);
  if(before.status!=='ready'||!before.preview||before.preview.candidateId!==input.candidateId)throw new Error('预览无效、已取消或过期，请重新读取。');
  const workspace=safeWorkspace(before.preview.workspace),doc=workspace.document;
  if(doc.kind!=='web')throw new Error('网页预览格式无效');
  if(doc.web.media.some(m=>m.status!=='saved')&&doc.web.extractorVersion!=='x-fxtwitter-public-v1'&&input.allowPartial!==true)throw new Error('图片或图表尚未完整导入，文章尚未加入。');
  const resources:Resource[]=[];let total=0;
  for(const media of doc.web.media.filter(m=>m.status==='saved')){
   if(resources.some(r=>r.id===media.resourceId))continue;
   const response=await hostedOperationFetch(`/web-imports/${id}/resources/${media.resourceId}`,id),type=response.headers.get('content-type')?.split(';')[0].trim();
   const bytes=new Uint8Array(await response.arrayBuffer());total+=bytes.length;
   if(cancelledWebJobs.has(id))throw new Error('读取已取消，文章尚未加入。');
   if(!type||type!==media.mime||bytes.length!==media.bytes||total>128*1024*1024||await sha256(bytes)!==media.resourceId)throw new Error('网页图片资源完整性校验失败，文章尚未加入。');
   resources.push({id:media.resourceId!,type,bytes});
  }
  const checked=await hostedOperationRequest<WebImportJob>(`/web-imports/${id}`,id);
  if(cancelledWebJobs.has(id)||checked.status!=='ready'||checked.preview?.candidateId!==before.preview.candidateId||canonical(checked.preview.workspace.document)!==canonical(doc))throw new Error('预览已取消、失效或改变，文章尚未加入。');
  const result=await transaction(true,s=>{
   if(cancelledWebJobs.has(id))throw new Error('读取已取消，文章尚未加入。');
   const existing=s.entries.find(e=>e.creationKey===input.creationKey)??findWeb(s,doc.web.originalUrl);if(existing)return {...existing,webImportCreated:false};
   for(const resource of resources)if(!s.resources.some(r=>r.id===resource.id))s.resources.push(resource);
   assertResources(s,workspace);const tickets=copyRetryTickets(before.preview!.retryTickets,doc.web.media.map(m=>m.id));if(Object.keys(tickets).length)(s.webRetryTickets??={})[doc.id]=tickets;const now=new Date().toISOString();
   const e:LibraryEntry={id:crypto.randomUUID(),version:1,revisionId:crypto.randomUUID(),source:null,workspace,position:{ratio:0},history:[],updatedAt:now,lastOpenedAt:now,creationKey:String(input.creationKey)};s.entries.push(e);return {...e,webImportCreated:true};
  });
  localWebJobs.set(id,{operationId:id,status:'existing',entryId:result.id,progress:'文章已保存到当前浏览器。'});
  void hostedOperationRequest(`/web-imports/${id}/release`,id,{}).catch(()=>{}).finally(()=>releaseHostedOperation(id));
  return result;
 }
 return hostedOperationRequest(path,id,body);
}

function entry(s:State,id:string){const e=s.entries.find(e=>e.id===id);if(!e)throw new BrowserStorageError('阅读条目不存在',404);return e;}
function checkVersion(e:LibraryEntry,v:unknown){if(e.version!==v)throw new BrowserStorageError('内容已在其他标签更新。当前草稿已保留，请备份后重新载入。',409);}
export async function browserRequest<T>(path='',body?:unknown):Promise<T>{const input=(body??{}) as Record<string,any>,url=new URL(path||'/', 'https://browser.invalid'),parts=url.pathname.split('/').filter(Boolean);
 if(parts[0]==='web-imports'||parts[0]==='x-article-imports')return await webRequest(path,parts,input,body) as T;
 if(parts[0]==='entries'&&parts[2]==='ocr'&&body!==undefined)return await saveOcr(parts[1],input) as T;
 if(parts[0]==='entries'&&parts[2]==='web-media'&&parts[4]==='retry')return await retryWebMedia(parts[1],decodeURIComponent(parts[3]),input.revisionId) as T;
 if(parts[0]==='entries'&&parts[2]==='translation-batches'){
  if(parts[4]==='cancel'){cancelHostedOperation(parts[3]);return await hostedOperationRequest(`/translation-batches/${parts[3]}/cancel`,parts[3],{}) as T;}
  // Units are rebuilt here from the saved original (web, Markdown or PDF text layer), never taken from the caller.
  const e=await transaction(false,s=>entry(s,parts[1])),doc=e.workspace.document;if(e.revisionId!==input.revisionId||documentTranslationVersion(doc)!==input.sourceVersion)throw new Error('翻译原文版本不匹配');
  const translationSource=doc.kind==='pdf'?await loadPdfTranslationSource(doc.pdf.resourceId,async()=>new Uint8Array(await (await browserBinary(`/entries/${e.id}/resources/${doc.pdf.resourceId}`)).arrayBuffer())):documentTranslationSource(doc);if(!translationSource)throw new Error('翻译原文版本不匹配');
  const source=translationSource.source,ids=input.unitIds;
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>16)throw new Error('翻译批次无效');
  const units=ids.map((id:unknown)=>source.units.find(u=>u.id===id));if(units.some(u=>!u)||units.reduce((n,u)=>n+u!.text.length,0)>4000)throw new Error('翻译批次超出范围');
  return await hostedOperationRequest('/translation-batches',input.operationId,{qualityVersion:TRANSLATION_QUALITY_VERSION,operationId:input.operationId,roundId:input.roundId,sourceVersion:input.sourceVersion,translationId:input.translationId,units}) as T;
 }
 return transaction(body!==undefined,(s)=>{
 if(!parts.length)return {entries:s.entries.map(e=>({id:e.id,version:e.version,lastOpenedAt:e.lastOpenedAt,filename:e.workspace.document.filename,path:null,historyCount:e.history.length,kind:e.workspace.document.kind??'markdown',...(e.workspace.document.kind==='web'?{url:e.workspace.document.web.originalUrl,importedAt:e.workspace.document.importedAt}:{})})),activeId:s.activeId,warnings:[],nativePicker:false} as T;
 if(parts[0]==='recoveries'){
 const records=s.recoveries??=[];
 if(parts.length===1)return records.filter(r=>!r.acknowledgedAt).map(r=>({id:r.id,entryId:r.entryId,createdAt:r.createdAt,state:r.state,resultEntryId:r.resultEntryId,filename:r.draft.workspace.document.filename,hasDifferences:true})) as T;
 const r=records.find(r=>r.id===parts[1]);if(!r)throw new Error('恢复记录不存在');
 if(parts[2]==='acknowledge'){r.acknowledgedAt=new Date().toISOString();return {} as T;}
 if(parts[2]==='resolve'){const original=entry(s,r.entryId);checkVersion(original,input.expectedVersion);let result=original;if(input.choice==='draft'){result={...original,id:crypto.randomUUID(),creationKey:crypto.randomUUID(),version:1,revisionId:r.draft.revisionId,workspace:safeWorkspace(r.draft.workspace),position:position(r.draft.position),history:[]};assertResources(s,result.workspace);s.entries.push(result);}r.state='resolved';r.choice=input.choice;r.resultEntryId=result.id;return {record:r,entry:result} as T;}
 const current=entry(s,r.entryId);return {...r,current:{workspace:current.workspace,position:current.position,revisionId:current.revisionId,version:current.version}} as T;
 }
 if(parts[0]==='entries'){
 if(parts.length===1){const w=safeWorkspace(input.workspace);assertResources(s,w);const existing=s.entries.find(e=>e.creationKey===input.creationKey);if(existing){if(input.activate===true)s.activeId=existing.id;return existing as T;}const now=new Date().toISOString();const e:LibraryEntry={id:crypto.randomUUID(),version:1,revisionId:crypto.randomUUID(),source:null,workspace:w,position:{ratio:0},history:[],updatedAt:now,lastOpenedAt:now,creationKey:String(input.creationKey)};s.entries.push(e);if(input.activate===true)s.activeId=e.id;return e as T;}
 const e=entry(s,parts[1]);
 if(parts.length===2)return e as T;
 if(parts[2]==='activate'){s.activeId=e.id;e.lastOpenedAt=new Date().toISOString();return e as T;}
 if(parts[2]==='check')return {status:'available',message:'原文与成果保存在当前浏览器'} as T;
 if(parts[2]==='save'){checkVersion(e,input.expectedVersion);const w=safeWorkspace(input.workspace);if(w.document.id!==e.workspace.document.id||w.document.contentHash!==e.workspace.document.contentHash||canonical(w.document)!==canonical(e.workspace.document))throw new Error('原文版本不匹配');assertResources(s,w);e.workspace=w;e.position=position(input.position);e.version++;e.updatedAt=new Date().toISOString();return e as T;}
 if(parts[2]==='recover'){const d=input as ReadingDraft;if(readingKey(e.workspace,e.position)===readingKey(d.workspace,d.position))return {kind:'same',entry:e} as T;if(e.version!==d.version){const r:RecoveryRecord={id:crypto.randomUUID(),entryId:e.id,createdAt:new Date().toISOString(),state:'pending',draft:{entryId:d.entryId,version:d.version,revisionId:d.revisionId,workspace:safeWorkspace(d.workspace),position:position(d.position)},disk:{workspace:e.workspace,position:e.position,revisionId:e.revisionId,version:e.version},previous:[],reason:'changed'};(s.recoveries??=[]).push(r);return {kind:'review',record:r} as T;}const w=safeWorkspace(d.workspace);assertResources(s,w);e.workspace=w;e.position=position(d.position);e.version++;return {kind:'restored',entry:e} as T;}
 if(parts[2]==='outline'){
  const doc=e.workspace.document;if(doc.kind!=='pdf'||doc.pdf.resourceId!==parts[3])throw new Error('目录原文版本不匹配');const outlines=s.outlines??={};const previous=outlines[parts[3]]??{version:1 as const,fileHash:parts[3],revision:0,reviewed:false,items:[]};if(body===undefined)return previous as T;
  const next=copyOutline(input,doc.pdf.resourceId,doc.pdf.pages.length);if(next.revision!==previous.revision)throw new BrowserStorageError('另一标签已更新目录，请重新载入。',409);next.revision++;outlines[parts[3]]=next;return next as T;
 }
 }
 if(parts[0]==='bookmarks'){
 const all=s.bookmarks;
 if(parts[1]==='lookup')return {bookmark:all.find(b=>bookmarkPosition(b)===bookmarkPosition(input as BookmarkCreate))??null} as T;
 if(parts[1]&&parts[2]==='location'){const b=all.find(b=>b.id===parts[1]);if(!b)throw new Error('收藏不存在');return {entry:entry(s,b.entryId),revisionId:b.revisionId} as T;}
 if(parts[1]&&parts[2]==='delete'){s.bookmarks=all.filter(b=>b.id!==parts[1]);s.bookmarkRevision++;return {} as T;}
 if(body!==undefined){const v=input as BookmarkCreate,e=entry(s,v.entryId);if(e.revisionId!==v.revisionId||v.anchor.documentId!==e.workspace.document.id)throw new Error('收藏原文版本不匹配');const found=all.find(b=>bookmarkPosition(b)===bookmarkPosition(v));if(found)return {bookmark:found,created:false,revision:s.bookmarkRevision} as T;const b:ReadingBookmark={id:crypto.randomUUID(),version:1,createdAt:new Date().toISOString(),creationOperationId:v.operationId,entryId:e.id,revisionId:e.revisionId,documentId:e.workspace.document.id,contentVersion:e.workspace.document.contentHash,sourceKind:e.workspace.document.kind??'markdown',sourceTitle:e.workspace.document.filename,anchor:safeAnchor(v.anchor),excerpt:bookmarkQuote(v.anchor),contextBefore:v.anchor.prefix.slice(-240),contextAfter:v.anchor.suffix.slice(0,240)};all.push(b);s.bookmarkRevision++;return {bookmark:b,created:true,revision:s.bookmarkRevision} as T;}
 const matching=all.filter(b=>(!url.searchParams.get('entryId')||b.entryId===url.searchParams.get('entryId'))&&bookmarkSearchScore(b,url.searchParams.get('q')??'')>0),offset=Number(url.searchParams.get('offset'))||0,limit=Number(url.searchParams.get('limit'))||50;return {bookmarks:matching.slice(offset,offset+limit),total:matching.length,revision:s.bookmarkRevision,warnings:[]} as T;
 }
 throw new Error('体验版暂不支持此操作');
 });}
export async function browserBinary(path:string,body?:Blob):Promise<Response>{const url=new URL(path,'https://browser.invalid'),parts=url.pathname.split('/').filter(Boolean);
 if(!body&&parts[0]==='web-imports'&&parts[2]==='resources')return hostedOperationFetch(path,parts[1]);
 if(!body&&parts[0]==='entries'&&parts[2]==='web-resources'){
  const resource=await transaction(false,s=>{const e=entry(s,parts[1]),w=e.revisionId===parts[3]?e.workspace:e.history.find(h=>h.id===parts[3])?.workspace;
   if(w?.document.kind!=='web'||!w.document.web.media.some(m=>m.status==='saved'&&m.resourceId===parts[4]))throw new Error('网页资源不属于当前阅读版本');
   assertResources(s,w);return s.resources.find(r=>r.id===parts[4])!;});
  if(await sha256(resource.bytes)!==resource.id)throw new Error('网页资源完整性校验失败');return new Response(new Uint8Array(resource.bytes),{headers:{'Content-Type':resource.type}});
 }
 if(body&&parts[0]==='pdf'){
 const bytes=new Uint8Array(await body.arrayBuffer()),id=await sha256(bytes);const {getDocument,GlobalWorkerOptions}=await import('pdfjs-dist');const {default:workerUrl}=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');GlobalWorkerOptions.workerSrc=workerUrl;const task=getDocument({data:bytes.slice(),cMapUrl:'/pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-assets/standard_fonts/',wasmUrl:'/pdf-assets/wasm/',enableXfa:false});try{const pdf=await task.promise;if(pdf.numPages>200)throw new Error('PDF 须不超过 200 页');const pages=[];for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);pages.push({view:p.view as [number,number,number,number],rotation:p.rotate});}await transaction(true,s=>{if(!s.resources.some(r=>r.id===id))s.resources.push({id,bytes,type:'application/pdf'});});const base=createInitialWorkspace();const workspace:Workspace={...base,document:{id:'pdf-'+id,filename:url.searchParams.get('filename')??'文档.pdf',kind:'pdf',pdf:{resourceId:id,pages},contentHash:id,importedAt:new Date().toISOString(),isDemo:false}};return Response.json({workspace,selectionId:id});}finally{await task.destroy();}}
 if(body&&parts[0]==='entries'&&parts[2]==='crops')return saveCrop(parts[1],url.searchParams,body);
 if(!body&&parts[2]==='resources'){const resource=await transaction(false,s=>{entry(s,parts[1]);return s.resources.find(r=>r.id===parts[3]);});if(!resource)throw new Error('资源不存在，请从完整备份恢复');return new Response(new Uint8Array(resource.bytes),{headers:{'Content-Type':resource.type}});}
 throw new Error('体验版暂不支持此文件操作');}
const PNG_SIGNATURE=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
const isPng=(bytes:Uint8Array)=>bytes.length>24&&PNG_SIGNATURE.every((b,i)=>bytes[i]===b);
// A selected PDF region is stored as its own resource so saves, backups and
// later requests use exactly the bytes the reader saw.
async function saveCrop(entryId:string,query:URLSearchParams,body:Blob):Promise<Response>{
 const bytes=new Uint8Array(await body.arrayBuffer());
 if(bytes.length>HOSTED_IMAGE_MAX_BYTES||!isPng(bytes))throw new Error('所选区域图片无效或过大，请缩小范围。');
 const fileHash=query.get('fileHash'),page=Number(query.get('page')),id=await sha256(bytes);
 await transaction(true,s=>{const doc=entry(s,entryId).workspace.document;
  if(doc.kind!=='pdf'||doc.pdf.resourceId!==fileHash||!Number.isInteger(page)||page<1||page>doc.pdf.pages.length)throw new Error('裁图与当前原页不符，请重新框选。');
  if(!s.resources.some(r=>r.id===id))s.resources.push({id,type:'image/png',bytes});});
 return new Response(JSON.stringify({id}),{headers:{'Content-Type':'application/json'}});
}
async function saveOcr(entryId:string,input:unknown){
 const data=copyOcr(input);if(!data)throw new Error('识别结果格式无效。');
 const bytes=new TextEncoder().encode(JSON.stringify(data)),id=await sha256(bytes);
 await transaction(true,s=>{const doc=entry(s,entryId).workspace.document;
  if(doc.kind!=='pdf'||doc.pdf.resourceId!==data.fileHash||data.page>doc.pdf.pages.length)throw new Error('识别结果与当前原页不符。');
  const [x0,y0,x1,y1]=doc.pdf.pages[data.page-1].view,margin=1;
  if(data.lines.some(l=>l.rect[0]<x0-margin||l.rect[1]<y0-margin||l.rect[2]>x1+margin||l.rect[3]>y1+margin))throw new Error('识别结果超出原页范围。');
  if(!s.resources.some(r=>r.id===id))s.resources.push({id,type:'application/json',bytes});});
 return {id,data};
}
const base64=(bytes:Uint8Array)=>{let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);};
// Backups carry only resources still referenced somewhere in the library, so abandoned crops,
// OCR text and deleted entries' files do not travel with them. A conservative scan keeps any
// resource whose id appears anywhere in the saved records.
function referencedIds(records:unknown):Set<string>{return new Set(JSON.stringify(records).match(/[a-f0-9]{64}/g)??[]);}
export async function browserBackup(){const s=await transaction(false,s=>s);const records={entries:s.entries.map(safeEntry),activeId:s.activeId,recoveries:(s.recoveries??[]).map(safeRecovery),sampleImages:s.sampleImages??{},webRetryTickets:s.webRetryTickets??{},outlines:s.outlines??{},bookmarks:s.bookmarks};const keep=referencedIds(records);const payload={...records,resources:s.resources.filter(r=>keep.has(r.id)).map(r=>({id:r.id,type:r.type,base64:base64(r.bytes)}))};const data=canonical(payload);return JSON.stringify({format:'got-it-browser-backup',version:1,sha256:await sha256(data),payload});}
export async function restoreBrowserBackup(raw:string){let value:any;try{value=JSON.parse(raw);}catch{throw new Error('备份文件损坏，阅读库未修改');}if(value.format!=='got-it-browser-backup'||value.version!==1||!value.payload||await sha256(canonical(value.payload))!==value.sha256)throw new Error('备份格式或完整性校验失败，阅读库未修改');const p=value.payload;if(!Array.isArray(p.entries)||!Array.isArray(p.resources)||!Array.isArray(p.bookmarks))throw new Error('备份结构无效');const resources:Resource[]=[];for(const r of p.resources){if(typeof r.base64!=='string'||typeof r.type!=='string')throw new Error('备份资源无效');const bytes=Uint8Array.from(atob(r.base64),x=>x.charCodeAt(0));if(await sha256(bytes)!==r.id)throw new Error('备份资源完整性校验失败');resources.push({id:r.id,type:r.type,bytes});}
 const entries:LibraryEntry[]=p.entries.map(safeEntry);if(new Set(entries.map(e=>e.id)).size!==entries.length)throw new Error('备份有重复条目');const check={...empty(),entries,resources};for(const e of entries){assertResources(check,e.workspace);for(const h of e.history)assertResources(check,h.workspace);}const bookmarks:ReadingBookmark[]=p.bookmarks.map((b:ReadingBookmark)=>{const e=entries.find(e=>e.id===b.entryId);if(!e||b.documentId!==e.workspace.document.id||b.anchor?.documentId!==b.documentId||typeof b.id!=='string'||!b.anchor||typeof b.excerpt!=='string')throw new Error('备份收藏关联无效');return {id:b.id,version:1,createdAt:b.createdAt,creationOperationId:b.creationOperationId,entryId:b.entryId,revisionId:b.revisionId,documentId:b.documentId,contentVersion:b.contentVersion,sourceKind:b.sourceKind,sourceTitle:b.sourceTitle,anchor:safeAnchor(b.anchor),excerpt:b.excerpt,contextBefore:String(b.contextBefore).slice(-240),contextAfter:String(b.contextAfter).slice(0,240)};});
 const outlines:Record<string,PdfOutline>={};for(const [hash,value]of Object.entries(p.outlines??{})){const doc=entries.map(e=>e.workspace.document).find(d=>d.kind==='pdf'&&d.pdf.resourceId===hash);if(!doc||doc.kind!=='pdf')throw new Error('PDF目录关联无效');outlines[hash]=copyOutline(value,hash,doc.pdf.pages.length);}
 const sampleImages:State['sampleImages']={};for(const [hash,list]of Object.entries(p.sampleImages??{})){if(!/^[a-f0-9]{64}$/.test(hash)||!Array.isArray(list))throw new Error('样例图片映射无效');sampleImages[hash]=list.map((v:any)=>{if(typeof v.url!=='string'||!v.url.startsWith('/hosted-samples/')||!resources.some(r=>r.id===v.id&&/^image\/(png|jpeg|webp)$/.test(r.type)))throw new Error('样例图片资源缺失');return {url:v.url,id:v.id};});}
 const webRetryTickets=Object.fromEntries(Object.entries(p.webRetryTickets??{}).map(([id,tickets])=>{const doc=entries.map(e=>e.workspace.document).find(d=>d.id===id);if(doc?.kind!=='web')throw new Error('图片重试凭据关联无效');return [id,copyRetryTickets(tickets,doc.web.media.map(m=>m.id))];}));
 const recoveries:RecoveryRecord[]=(p.recoveries??[]).map(safeRecovery);for(const r of recoveries){if(!entries.some(e=>e.id===r.entryId))throw new Error('恢复记录关联无效');assertResources(check,r.draft.workspace);if(r.disk)assertResources(check,r.disk.workspace);}
 await transaction(true,s=>{if(entries.some(e=>s.entries.some(old=>old.id===e.id||old.workspace.document.id===e.workspace.document.id))||bookmarks.some(b=>s.bookmarks.some(old=>old.id===b.id)))throw new BrowserStorageError('备份与当前阅读库冲突。现有内容未覆盖；请在空的浏览器阅读库恢复，或保留两份备份后处理。',409);s.entries.push(...entries);Object.assign(s.webRetryTickets??={},webRetryTickets);Object.assign(s.sampleImages??={},sampleImages);Object.assign(s.outlines??={},outlines);for(const r of resources)if(!s.resources.some(old=>old.id===r.id))s.resources.push(r);s.bookmarks.push(...bookmarks);(s.recoveries??=[]).push(...recoveries);s.bookmarkRevision++;s.activeId??=entries.find(e=>e.id===p.activeId)?.id??entries[0]?.id??null;});}
export async function browserStorageStatus(requestPersist=false){const storage=navigator.storage;let persistent=false;try{persistent=await storage?.persisted?.()??false;if(requestPersist&&!persistent)persistent=await storage?.persist?.()??false;}catch{}const estimate=await storage?.estimate?.().catch(()=>({}))??{};return {persistent,...estimate};}

export async function storeSampleImages(hash:string,images:{url:string;bytes:Uint8Array;type:string}[]){const resources=await Promise.all(images.map(async image=>({...image,id:await sha256(image.bytes)})));await transaction(true,s=>{for(const image of resources){if(!s.resources.some(r=>r.id===image.id))s.resources.push({id:image.id,bytes:image.bytes,type:image.type});}(s.sampleImages??={})[hash]=resources.map(({url,id})=>({url,id}));});}
export async function loadSampleImages(hash:string):Promise<Record<string,string>>{return transaction(false,s=>Object.fromEntries((s.sampleImages?.[hash]??[]).map(image=>{const r=s.resources.find(r=>r.id===image.id);if(!r)throw new Error('样例图片资源缺失');return [image.url,`data:${r.type};base64,${base64(r.bytes)}`];})));}
