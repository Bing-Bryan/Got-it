import {marked} from 'marked';
import {retryableWebTransport} from './web-proxy';
import {normalizeXArticleUrl,xPublicAddress} from '../src/lib/x-article-url';
import {createHash, randomUUID} from 'node:crypto';
import {createInitialWorkspace} from '../src/sample';
import {safeWebUrl, type WebMedia} from '../src/lib/web-data';
import {X_CAPTURE_EXTRACTOR, X_CAPTURE_MAX_BYTES, type XCaptureNode, type XArticleCapture} from '../src/lib/x-article-capture';
import {fetchWeb, WEB_LIMITS, WebError, type WebBudget, type FetchedWeb} from './web-fetch';
import {validateStaticImage, type ValidImage} from './web-media';
import type {ExtractedWeb} from './web-extract';
const invalid = () => new WebError('X 文章文件格式或内容无效，请重新使用 got-it 书签捕获。', 'x_capture_invalid');
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function keys(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).some(k=>!allowed.includes(k))) throw invalid(); }
export function xArticleUrl(input: unknown): URL {
 if (typeof input !== 'string' || !safeWebUrl(input)) throw invalid();
 const normalized=normalizeXArticleUrl(input);if(!normalized||xPublicAddress(input)?.kind!=='article')throw invalid();
 const u=new URL(normalized);
 if(u.protocol!=='https:'||!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)||u.port||u.search||u.hash||!/^\/(?:i\/article\/\d+|[A-Za-z0-9_]+\/article\/\d+)\/?$/.test(u.pathname))throw invalid();
 return new URL(`https://x.com${u.pathname.replace(/\/$/,'')}`);
}
export function xMediaUrl(input: unknown): URL {
 if(typeof input!=='string'||!safeWebUrl(input))throw new WebError('X 图片地址不在允许范围内。','x_media_invalid');
 const u=new URL(input);
 if(u.protocol!=='https:'||u.hostname!=='pbs.twimg.com'||u.port||u.hash||!/^\/media\/[A-Za-z0-9_-]+(?:\.(?:jpg|jpeg|png|webp|gif))?$/.test(u.pathname)||[...u.searchParams.keys()].some(k=>!['format','name'].includes(k))||u.searchParams.getAll('format').length>1||u.searchParams.getAll('name').length>1||u.searchParams.has('format')&&!/^(jpg|jpeg|png|webp|gif)$/.test(u.searchParams.get('format')!)||u.searchParams.has('name')&&!/^(orig|large|medium|small|thumb|\d+x\d+)$/.test(u.searchParams.get('name')!))throw new WebError('X 图片地址不在允许范围内。','x_media_invalid');
 return u;
}
function parseXContent(input: unknown, publicContent=false): XArticleCapture {
 if(!record(input))throw invalid();
 let bytes: number;try{bytes=Buffer.byteLength(JSON.stringify(input));}catch{throw invalid();}if(bytes>X_CAPTURE_MAX_BYTES)throw new WebError('X 文章文件超过 2 MiB，请重新捕获较小的文章。','x_capture_budget');
 keys(input,['format','version','url','title','nodes']);
 if(input.format!=='got-it-x-article'||input.version!==1||typeof input.title!=='string'||input.title.trim().length<2||input.title.length>1000||!Array.isArray(input.nodes)||!input.nodes.length)throw invalid();
 const url=publicContent?xPublicAddress(input.url)?.url:xArticleUrl(input.url).href;if(!url)throw invalid();let count=0,chars=0,images=0,paragraphs=0;
 const inline=new Set(['text','strong','em','link','code']);
 function nodes(values: unknown[],depth: number,context='block'): XCaptureNode[] {
  if(depth>12)throw invalid();
  return values.map(v=>{
   if(++count>2000||!record(v)||typeof v.type!=='string')throw invalid();
   const type=v.type;
   if(context==='table'&&type!=='row'||context==='row'&&type!=='cell'||['table','row','cell'].includes(type)&&(!publicContent||type==='table'&&context!=='block'||type==='row'&&context!=='table'||type==='cell'&&context!=='row'))throw invalid();
   if(context==='inline'&&!inline.has(type)||context==='list'&&type!=='item'||type==='item'&&context!=='list')throw invalid();
   if(['text','code','pre'].includes(type)){keys(v,['type','text',...(publicContent&&type==='pre'?['language']:[]),...(publicContent&&type==='text'?['preserveBreaks']:[])]);if(v.language!==undefined&&(typeof v.language!=='string'||!/^[A-Za-z0-9_+-]{1,40}$/.test(v.language)))throw invalid();if(v.preserveBreaks!==undefined&&typeof v.preserveBreaks!=='boolean')throw invalid();if(typeof v.text!=='string'||v.text.length>500000)throw invalid();chars+=v.text.length;if(chars>500000)throw invalid();return{type,text:v.text,...(v.language===undefined?{}:{language:v.language as string}),...(v.preserveBreaks===undefined?{}:{preserveBreaks:v.preserveBreaks as boolean})};}
   if(type==='hr'){keys(v,['type']);return{type};}
   if(type==='image'){keys(v,['type','url','alt',...(publicContent?['poster']:[])]);if(v.poster!==undefined&&v.poster!==true)throw invalid();if(typeof v.alt!=='string'||v.alt.length>4000||++images>WEB_LIMITS.mediaCount)throw invalid();return{type,url:(v.poster?xPosterUrl:xMediaUrl)(v.url).href,alt:v.alt,...(v.poster?{poster:true}:{})};}
   if(!['paragraph','heading','list','item','quote','strong','em','link',...(publicContent?['table','row','cell']:[])].includes(type))throw invalid();
   keys(v,['type','children',...(type==='heading'?['level']:type==='list'?['ordered']:type==='link'?['url']:type==='cell'?['align']:[])]);
   if(!Array.isArray(v.children)||!v.children.length)throw invalid();
   if(type==='paragraph')paragraphs++;
   const n:XCaptureNode={type,children:nodes(v.children,depth+1,['paragraph','heading','strong','em','link','cell'].includes(type)?'inline':type==='list'?'list':type==='table'?'table':type==='row'?'row':'block')};
   if(type==='cell'&&v.align!==undefined){if(!['left','center','right'].includes(String(v.align)))throw invalid();n.align=v.align as 'left'|'center'|'right';}
   if(type==='table'&&(n.children!.length<2||n.children!.length>200||n.children!.some(r=>r.children!.length!==n.children![0].children!.length)||n.children![0].children!.length>30))throw invalid();
   if(type==='heading'){if(!Number.isInteger(v.level)||Number(v.level)<1||Number(v.level)>6)throw invalid();n.level=Number(v.level);}
   if(type==='list'){if(typeof v.ordered!=='boolean')throw invalid();n.ordered=v.ordered;}
   if(type==='link'){const u=safeWebUrl(v.url);if(!u)throw invalid();n.url=u;}
   return n;
  });
 }
 const parsed=nodes(input.nodes,0);if(publicContent?chars<1&&images===0:chars<300||paragraphs<2)throw invalid();
 return{format:'got-it-x-article',version:1,url,title:input.title.replace(/\s+/g,' ').trim(),nodes:parsed};
}
export function parseXArticleCapture(input:unknown):XArticleCapture{return parseXContent(input);}
/** Server-only content validation; the file/API capture protocol keeps its original constraints. */
export function parseXPublicContent(input:{url:string;title:string;nodes:XCaptureNode[]}):XArticleCapture{return parseXContent({format:'got-it-x-article',version:1,...input},true);}
export function xPosterUrl(input:unknown):URL{if(typeof input!=='string'||!safeWebUrl(input))throw invalid();const u=new URL(input);if(u.protocol!=='https:'||u.hostname!=='pbs.twimg.com'||u.port||u.hash||!/^\/amplify_video_thumb\/\d{1,30}\/img\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(u.pathname)||[...u.searchParams.keys()].some(k=>k!=='name')||u.searchParams.getAll('name').length>1||u.searchParams.has('name')&&u.searchParams.get('name')!=='orig')throw invalid();return u;}
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/[\\`*_[\]<>#!|~+=.(){}-]/g,c=>'\\'+c);
export async function extractXArticle(capture: XArticleCapture, options:{signal:AbortSignal;progress?:(s:string)=>void;budget?:WebBudget;retrieval?:{kind:'public-service';provider:'fxtwitter';url:string};identity?:{statusId:string;articleId:string;handle:string};fetcher?:(url:string,maxBytes:number,budget:WebBudget,signal?:AbortSignal)=>Promise<FetchedWeb>}):Promise<ExtractedWeb>{
 const media:WebMedia[]=[],resources=new Map<string,ValidImage>(),budget=options.budget??{requests:0,bytes:0};let totalMedia=0;
 const fetcher=options.fetcher,mediaController=new AbortController(),mediaSignal=AbortSignal.any([options.signal,mediaController.signal]);
 let imageCursor=0;
 function itemFor(n:XCaptureNode):WebMedia{return{id:randomUUID(),kind:'image',status:'missing',alt:n.alt!,...(options.retrieval?{sourceUrl:(n.poster?xPosterUrl:xMediaUrl)(n.url).href}:{})};}
 async function saveImage(n:XCaptureNode,item:WebMedia){
  mediaSignal.throwIfAborted();
  try{const validate=n.poster?xPosterUrl:xMediaUrl;const get=()=>{mediaSignal.throwIfAborted();return(fetcher??((url,maxBytes,budget,signal)=>fetchWeb(url,{signal:signal!,maxBytes,budget,validateUrl:validate})))(validate(n.url).href,WEB_LIMITS.imageBytes,budget,mediaSignal);};let fetched:FetchedWeb;try{fetched=await get();}catch(error){mediaSignal.throwIfAborted();if(!options.retrieval||!retryableWebTransport(error))throw error;fetched=await get();}validate(fetched.url);const image=await validateStaticImage(fetched.bytes);if(fetched.type.split(';')[0].trim()!==image.mime)throw new WebError('图片类型与内容不一致。','web_image');mediaSignal.throwIfAborted();
   // No await between checking the aggregate and committing it: concurrent completions cannot overbook bytes.
   if(totalMedia+image.bytes.length>WEB_LIMITS.mediaBytes)throw new WebError('文章图片总容量超过限制。','web_budget');totalMedia+=image.bytes.length;
   const id=createHash('sha256').update(image.bytes).digest('hex');resources.set(id,image);Object.assign(item,{status:'saved',resourceId:id,mime:image.mime,bytes:image.bytes.length,width:image.width,height:image.height});
  }catch(e){mediaSignal.throwIfAborted();if(e instanceof WebError&&e.code==='web_budget'||options.retrieval&&!['web_transport_transient','web_unavailable','web_proxy'].includes((e as {code?:string})?.code??''))throw e;item.reason=(e as {code?:string})?.code==='web_proxy'?'图片公开网络连接失败，未保存到本机。':e instanceof WebError?e.message:'图片保存失败，请重试。';}
 }
 if(options.retrieval){
  const images:XCaptureNode[]=[];const collect=(nodes:XCaptureNode[])=>{for(const n of nodes){if(n.type==='image')images.push(n);else if(n.children)collect(n.children);}};collect(capture.nodes);
  media.push(...images.map(itemFor));let next=0,completed=0,saved=0,failed=0;options.signal.throwIfAborted();
  if(images.length)options.progress?.(`处理 X 文章图片 0/${images.length}（已保存0，失败0）…`);
  const worker=async()=>{while(next<images.length){mediaSignal.throwIfAborted();const index=next++;await saveImage(images[index],media[index]);mediaSignal.throwIfAborted();if(media[index].status==='saved')saved++;else failed++;options.progress?.(`处理 X 文章图片 ${++completed}/${images.length}（已保存${saved}，失败${failed}）…`);}};
  let failure:unknown;const results=await Promise.allSettled(Array.from({length:Math.min(3,images.length)},()=>worker().catch(error=>{failure??=error;mediaController.abort(error);throw error;})));if(results.some(r=>r.status==='rejected'))throw failure;
 }
 async function render(n:XCaptureNode):Promise<string>{
  options.signal.throwIfAborted();
  if(n.type==='text')return n.preserveBreaks?n.text!.split(/\r?\n/).map(line=>escape(line.replace(/[\t ]+/g,' '))).join('  \n'):escape(n.text!.replace(/\s+/g,' '));
  if(n.type==='pre'||n.type==='code'){const raw=n.type==='code'?n.text!.replace(/\s+/g,' '):n.text!,fence='`'.repeat(Math.max(n.type==='pre'?3:1,...[...raw.matchAll(/`+/g)].map(m=>m[0].length+1)));return n.type==='pre'?`\n\n${fence}${n.language??''}\n${raw}\n${fence}\n\n`:`${fence} ${raw} ${fence}`;}
  if(n.type==='hr')return'\n\n---\n\n';
  if(n.type==='image'){
   const item=options.retrieval?media[imageCursor++]:itemFor(n);
   if(!options.retrieval){media.push(item);options.progress?.(`保存 X 文章图片 ${media.length}…`);await saveImage(n,item);}
   return`\n\n![${escape(n.alt!)}](got-it-media:${item.id})\n\n`;
  }
  const rendered:string[]=[];for(const c of n.children!)rendered.push(await render(c));const text=rendered.join('');
  if(n.type==='cell')return marked.parseInline(text,{async:false});
  if(n.type==='row')return rendered.map((s,i)=>`<td${n.children![i].align?` align="${n.children![i].align}"`:''}>${s}</td>`).join('');
  if(n.type==='table')return '\n\n<table>\n<thead><tr>'+rendered[0].replace(/<(\/?)(td)(?=[ >])/g,'<$1th')+'</tr></thead>\n<tbody>'+rendered.slice(1).map(s=>'<tr>'+s+'</tr>').join('\n')+'</tbody>\n</table>\n\n';
  if(n.type==='paragraph')return'\n\n'+text+'\n\n';
  if(n.type==='heading')return`\n\n${'#'.repeat(n.level!)} ${text.trim().replace(/\n/g,' ')}\n\n`;
  if(n.type==='strong'||n.type==='em'){const tag=n.type==='strong'?'strong':'em';return `<${tag}>${text}</${tag}>`;}
  if(n.type==='link')return`[${text}](<${n.url!.replace(/[<>]/g,'')}>)`;
  if(n.type==='quote')return'\n\n'+text.trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
  if(n.type==='list')return'\n\n'+rendered.map((s,i)=>{const prefix=n.ordered?`${i+1}. `:'- ';return prefix+s.trim().split('\n').map((l,j)=>j?' '.repeat(prefix.length)+l:l).join('\n');}).join('\n')+'\n\n';
  return text;
 }
 let markdown='# '+escape(capture.title)+'\n\n';for(const n of capture.nodes)markdown+=await render(n);markdown=markdown.trim()+'\n';
 const importedAt=new Date().toISOString(),web={version:1 as const,originalUrl:capture.url,finalUrl:capture.url,extractorVersion:options.retrieval?'x-fxtwitter-public-v1':X_CAPTURE_EXTRACTOR,...(options.retrieval?{retrieval:options.retrieval}:{}),...(options.identity?{identity:options.identity}:{}),contentVersion:createHash('sha256').update(JSON.stringify(options.retrieval?[markdown,media,[],options.retrieval,...(options.identity?[options.identity]:[])]:[markdown,media,[]])).digest('hex'),media,fragments:[]};
 return{workspace:{...createInitialWorkspace(),document:{kind:'web',id:randomUUID(),filename:capture.title,markdown,web,contentHash:web.contentVersion,importedAt,isDemo:false},updatedAt:importedAt,hasUnexportedChanges:false},resources};
}
