import {marked, type Token} from 'marked';
import {safeWebUrl} from '../src/lib/web-data';
import {normalizeXArticleUrl,xPublicAddress} from '../src/lib/x-article-url';
import type {XCaptureNode, XArticleCapture} from '../src/lib/x-article-capture';
import {extractXArticle,parseXPublicContent,xMediaUrl,xPosterUrl} from './x-article-capture';
import {fetchWeb,WebError,type WebBudget,type FetchedWeb} from './web-fetch';
import type {ExtractedWeb} from './web-extract';
const bad=()=>new WebError('FxTwitter 返回的文章身份或正文结构无法可靠读取，请重试或打开原网页。','x_public_structure');
const unsupported=()=>new WebError('文章包含暂不支持的表格、代码或嵌入内容，请在原网页查看。','x_public_content_unsupported');
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const digits=(v:unknown)=>typeof v==='string'&&/^\d{1,30}$/.test(v);
export function xPublicEndpoint(input:string):URL {
 const normalized=normalizeXArticleUrl(input);if(!normalized)throw bad();return new URL(`https://api.fxtwitter.com/2/status/${new URL(normalized).pathname.split('/').at(-1)}`);
}
export function validateXPublicEndpoint(input:string,expected:string):URL {if(input!==expected)throw new WebError('FxTwitter 接口跳转离开批准目标。','x_public_endpoint');const u=new URL(input);if(u.protocol!=='https:'||u.hostname!=='api.fxtwitter.com'||u.port||u.search||u.hash||!/^\/2\/status\/\d{1,30}$/.test(u.pathname))throw bad();return u;}
export function adaptXPublicArticle(input:unknown,source:string,expectedStatusId?:string,profileProven=false):XArticleCapture {
 const normalized=normalizeXArticleUrl(source);if(!normalized||!record(input)||input.code!==200||!record(input.status))throw bad();
 const url=new URL(normalized),id=expectedStatusId??url.pathname.split('/').at(-1)!,handle=url.pathname.split('/')[1],status=input.status,article=status.article;
 if(status.id!==id||!record(status.author)||typeof status.author.screen_name!=='string'||!/^\w{1,15}$/.test(status.author.screen_name)||status.author.protected===true||handle!=='i'&&handle.toLowerCase()!==status.author.screen_name.toLowerCase()||!record(article)||!digits(article.id)||typeof article.title!=='string'||!record(article.content)||!Array.isArray(article.content.blocks)||!article.content.blocks.length||article.content.blocks.length>2000||!Array.isArray(article.content.entityMap)||article.content.entityMap.length>2000||article.media_entities!=null&&!Array.isArray(article.media_entities)||Array.isArray(article.media_entities)&&article.media_entities.length>100)throw bad();
 if(!xPublicAddress(source)?.handle&&xPublicAddress(source)?.kind==='article'&&article.id!==xPublicAddress(source)?.id)throw new WebError('请使用原帖分享链接读取这个文章。','x_article_unresolved');
 if(expectedStatusId&&expectedStatusId!==xPublicAddress(source)?.id&&(!profileProven&&!provenIdentity(status)||article.id!==xPublicAddress(source)?.id))throw bad();
 const content=article.content,entities=new Map<string,Record<string,any>>(),media=new Map<string,string|undefined>(),used=new Set<string>();
 function image(m:unknown):string|undefined {if(!record(m)||!digits(m.media_id)||!record(m.media_info)||!['ApiImage','ApiVideo'].includes(m.media_info.__typename) )throw bad();const video=m.media_info.__typename==='ApiVideo';if(video&&(m.media_info.preview_image==null||record(m.media_info.preview_image)&&!Object.keys(m.media_info.preview_image).length))return;const raw=video?m.media_info.preview_image?.original_img_url:m.media_info.original_img_url;const u=(video?xPosterUrl:xMediaUrl)(raw);u.searchParams.set('name','orig');return(video?xPosterUrl:xMediaUrl)(u.href).href;}
 for(const m of article.media_entities??[]){const src=image(m);if(media.has(m.media_id))throw bad();media.set(m.media_id,src);}
 for(const e of content.entityMap){if(!record(e)||typeof e.key!=='string'||!/^\d{1,6}$/.test(e.key)||entities.has(e.key)||!record(e.value)||typeof e.value.type!=='string'||!record(e.value.data))throw bad();const v=e.value;if(!['LINK','MEDIA','DIVIDER','MARKDOWN','TWEET'].includes(v.type))throw unsupported();if(v.data.entityKey!==undefined&&(typeof v.data.entityKey!=='string'||! /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.data.entityKey)))throw bad();
  if(v.type==='LINK'&&!safeWebUrl(v.data.url))throw bad();
  if(v.type==='MEDIA'&&(!Array.isArray(v.data.mediaItems)||!v.data.mediaItems.length||v.data.mediaItems.length>100||v.data.mediaItems.some((m:unknown)=>!record(m)||!['DraftTweetImage','AmplifyVideo'].includes(m.mediaCategory)||!digits(m.mediaId)||!media.has(m.mediaId))))throw bad();
  if(v.type==='MARKDOWN')markdownNode(v.data);
  if(v.type==='TWEET'&&(Object.keys(v.data).some(k=>!['entityKey','tweetId'].includes(k))||!digits(v.data.tweetId)))throw bad();
  if(v.type==='DIVIDER'&&Object.keys(v.data).some(k=>k!=='entityKey'))throw bad();entities.set(e.key,v);
 }
 let rangeCount=0,totalText=0;
 const blockKeys=new Set<string>(),nodes:XCaptureNode[]=[],listStack:XCaptureNode[]=[];
 function range(r:unknown,text:string){if(++rangeCount>10000||!record(r)||!Number.isSafeInteger(r.offset)||!Number.isSafeInteger(r.length)||r.offset<0||r.length<=0||r.offset+r.length>text.length)throw bad();for(const p of[r.offset,r.offset+r.length])if(p>0&&p<text.length&&/[\uD800-\uDBFF]/.test(text[p-1])&&/[\uDC00-\uDFFF]/.test(text[p]))throw bad();return r;}
 function inline(b:Record<string,any>):XCaptureNode[]{const text=b.text,styles=b.inlineStyleRanges.map((r:unknown)=>{const v=range(r,text);if(Object.keys(v).some(k=>!['offset','length','style'].includes(k))||!['Bold','Italic'].includes(v.style))throw bad();return v;});const links=b.entityRanges.map((r:unknown)=>{const v=range(r,text);if(Object.keys(v).some(k=>!['offset','length','key'].includes(k))||!(typeof v.key==='number'&&Number.isSafeInteger(v.key)||typeof v.key==='string'&&/^\d{1,6}$/.test(v.key)))throw bad();const entity=entities.get(String(v.key));if(!entity||entity.type!=='LINK')throw bad();return{...v,url:entity.data.url};}).sort((a:any,b:any)=>a.offset-b.offset);
  for(let i=1;i<links.length;i++)if(links[i].offset<links[i-1].offset+links[i-1].length)throw bad();
  const points=[...new Set<number>([0,text.length,...styles.flatMap((r:any)=>[r.offset,r.offset+r.length]),...links.flatMap((r:any)=>[r.offset,r.offset+r.length])])].sort((a,b)=>a-b);if(points.length>2001)throw bad();const out:XCaptureNode[]=[];
  for(let i=0;i<points.length-1;i++){const start=points[i],end=points[i+1];if(start===end)continue;let n:XCaptureNode={type:'text',text:text.slice(start,end)};const active=styles.filter((r:any)=>r.offset<=start&&r.offset+r.length>=end);for(const style of['Italic','Bold'])if(active.some((r:any)=>r.style===style))n={type:style==='Bold'?'strong':'em',children:[n]};const link=links.find((r:any)=>r.offset<=start&&r.offset+r.length>=end);if(link)n={type:'link',url:link.url,children:[n]};out.push(n);}return out;
 }
 if(article.cover_media!=null){if(!record(article.cover_media))throw bad();if(Object.keys(article.cover_media).length){if(article.cover_media.media_info?.__typename!=='ApiImage')throw bad();nodes.push({type:'image',url:image(article.cover_media),alt:'文章封面'});}}
 for(const b of content.blocks){if(!record(b)||Object.keys(b).some(k=>!['data','entityRanges','inlineStyleRanges','key','text','type','depth'].includes(k))||!record(b.data)||Object.keys(b.data).some(k=>k!=='mentions')||typeof b.key!=='string'||!b.key||blockKeys.has(b.key)||typeof b.text!=='string'||!Array.isArray(b.entityRanges)||!Array.isArray(b.inlineStyleRanges)||b.entityRanges.length+b.inlineStyleRanges.length>1000||!['unstyled','header-one','header-two','header-three','header-four','header-five','header-six','ordered-list-item','unordered-list-item','blockquote','atomic'].includes(b.type))throw bad();validateMentions(b);blockKeys.add(b.key);totalText+=b.text.length;if(totalText>500000)throw bad();
  const depth=b.depth===undefined?0:b.depth;if(!Number.isInteger(depth)||depth<0||depth>10||!b.type.endsWith('-list-item')&&depth!==0)throw bad();
  if(b.type==='atomic'){listStack.length=0;if(b.inlineStyleRanges.length||b.entityRanges.length!==1||b.text.trim())throw bad();const r=range(b.entityRanges[0],b.text);if(Object.keys(r).some(k=>!['key','offset','length'].includes(k))||r.offset!==0||r.length!==b.text.length)throw bad();const entity=entities.get(String(r.key));if(!entity||entity.type==='LINK')throw bad();if(entity.type==='DIVIDER')nodes.push({type:'hr'});else if(entity.type==='TWEET')nodes.push({type:'paragraph',children:[{type:'text',text:'内嵌帖子正文未保存，'},{type:'link',url:`https://x.com/i/status/${entity.data.tweetId}`,children:[{type:'text',text:'在原站查看'}]}]});else if(entity.type==='MARKDOWN'){const code=markdownNode(entity.data);totalText+=entity.data.markdown.length;if(totalText>500000)throw bad();nodes.push(code);}else for(const m of entity.data.mediaItems){used.add(m.mediaId);const matched=(article.media_entities??[]).find((v:any)=>v.media_id===m.mediaId),video=matched.media_info.__typename==='ApiVideo';if(video!==(m.mediaCategory==='AmplifyVideo'))throw bad();nodes.push(...(video?videoNodes(media.get(m.mediaId)!,normalizeStatusSource(status),true):[{type:'image',url:media.get(m.mediaId)!,alt:'文章配图'}]));}continue;}
  const children=inline(b);if(!children.length){if(b.type!=='unstyled')throw bad();listStack.length=0;continue;}
  if(b.type.endsWith('-list-item')){const ordered=b.type==='ordered-list-item';if(depth>listStack.length)throw bad();while(listStack.length>depth+1)listStack.pop();if(!listStack[depth]||listStack[depth].ordered!==ordered){const list:XCaptureNode={type:'list',ordered,children:[]};if(depth===0)nodes.push(list);else{const parent=listStack[depth-1]?.children?.at(-1);if(!parent)throw bad();parent.children!.push(list);}listStack.length=depth;listStack.push(list);}listStack[depth].children!.push({type:'item',children});continue;}
  listStack.length=0;
  if(b.type==='unstyled')nodes.push({type:'paragraph',children});else if(b.type==='blockquote')nodes.push({type:'quote',children});else nodes.push({type:'heading',level:['header-one','header-two','header-three','header-four','header-five','header-six'].indexOf(b.type)+1,children});
 }
 if([...media.keys()].some(id=>!used.has(id)))throw bad();
 if(!content.blocks.some((b:any)=>b.type!=='atomic'&&b.text.trim())&&!used.size&&!nodes.some(n=>n.type==='pre'&&n.text?.trim()||n.type==='table'&&hasText(n)))throw bad();return parseXPublicContent({url:normalized,title:article.title,nodes});
}
function hasText(n:XCaptureNode):boolean{return !!n.text?.trim()||!!n.children?.some(hasText);}
function normalizeStatusSource(status:Record<string,any>):string{const address=xPublicAddress(status.url);if(!address||address.kind!=='status'||address.id!==status.id||address.handle&&address.handle.toLowerCase()!==status.author?.screen_name?.toLowerCase())throw bad();return address.url;}
export function provenIdentity(status:Record<string,any>):{statusId:string;articleId:string;handle:string}|undefined{
 if(!digits(status.id)||!record(status.article)||!digits(status.article.id)||!record(status.author)||typeof status.author.screen_name!=='string'||!/^\w{1,15}$/.test(status.author.screen_name)||!record(status.raw_text)||typeof status.raw_text.text!=='string'||!Array.isArray(status.raw_text.facets)||status.raw_text.facets.length>2000)return;
 const statusAddress=xPublicAddress(status.url);if(!statusAddress||statusAddress.kind!=='status'||statusAddress.id!==status.id||statusAddress.handle&&statusAddress.handle.toLowerCase()!==status.author.screen_name.toLowerCase())return;
 const found=status.raw_text.facets.some((f:any)=>{if(!record(f)||f.type!=='url'||!Array.isArray(f.indices)||f.indices.length!==2||!f.indices.every(Number.isSafeInteger)||f.indices[0]<0||f.indices[1]<=f.indices[0]||f.indices[1]>status.raw_text.text.length||f.indices.some((p:number)=>p>0&&p<status.raw_text.text.length&&/[\uD800-\uDBFF]/.test(status.raw_text.text[p-1])&&/[\uDC00-\uDFFF]/.test(status.raw_text.text[p]))||typeof f.original!=='string'||status.raw_text.text.slice(f.indices[0],f.indices[1])!==f.original)return false;const u=xPublicAddress(f.replacement);return u?.kind==='article'&&u.id===status.article.id&&(!u.handle||u.handle.toLowerCase()===status.author.screen_name.toLowerCase());});
 return found?{statusId:status.id,articleId:status.article.id,handle:status.author.screen_name}:undefined;
}
function validateMentions(block:Record<string,any>){
 if(block.data.mentions===undefined)return;const mentions=block.data.mentions;
 if(!Array.isArray(mentions)||mentions.length>1000)throw bad();
 for(const m of mentions){if(!record(m)||Object.keys(m).some(k=>!['fromIndex','toIndex','text'].includes(k))||!Number.isSafeInteger(m.fromIndex)||!Number.isSafeInteger(m.toIndex)||m.fromIndex<0||m.toIndex<=m.fromIndex||m.toIndex>block.text.length||typeof m.text!=='string'||!/^\w{1,15}$/.test(m.text)||block.text.slice(m.fromIndex,m.toIndex)!=='@'+m.text)throw bad();}
}
/** Only the observed whole pipe-table grammar and bounded safe inline syntax are accepted. */
function markdownNode(data:Record<string,any>):XCaptureNode{
 if(Object.keys(data).some(k=>!['markdown','entityKey'].includes(k))||typeof data.markdown!=='string'||data.markdown.length>500000)throw bad();
 if(data.markdown.startsWith('```'))return codeNode(data);
 const lines=data.markdown.replace(/\r\n/g,'\n').trim().split('\n');
 if(lines.length<3||lines.length>200||lines.some(l=>!/^\s*\|.*\|\s*$/.test(l)))throw unsupported();
 const tokens=marked.lexer(data.markdown);if(tokens.length!==1||tokens[0].type!=='table')throw unsupported();const table=tokens[0] as import('marked').Tokens.Table;
 const width=table.header.length;if(width<1||width>30||table.rows.length!==lines.length-2)throw bad();
 // Tokenize each row as a header to detect padding/truncation without reimplementing GFM escaped pipes.
 for(const line of [lines[0],...lines.slice(2)]){const row=marked.lexer(line+'\n'+lines[1]);if(row.length!==1||row[0].type!=='table'||row[0].header.length!==width)throw unsupported();}
 function inline(tokens:Token[],depth=0):XCaptureNode[]{if(depth>10||tokens.length>1000)throw bad();return tokens.map(t=>{
  if(t.type==='text'||t.type==='escape')return{type:'text',text:t.text};
  if(t.type==='codespan')return{type:'code',text:t.text};
  if(t.type==='strong'||t.type==='em')return{type:t.type,children:inline(t.tokens??[],depth+1)};
  if(t.type==='link'){const url=safeWebUrl(t.href);if(!url||t.title!=null)throw bad();return{type:'link',url,children:inline(t.tokens??[],depth+1)};}
  if(t.type==='html'||t.type==='image')throw bad();
  throw unsupported();
 });}
 return{type:'table',children:[table.header,...table.rows].map(row=>({type:'row',children:row.map(c=>({type:'cell',...(c.align?{align:c.align}:{}),children:c.tokens.length?inline(c.tokens):[{type:'text',text:''}]}))}))};
}
function codeNode(data:Record<string,any>):XCaptureNode{if(Object.keys(data).some(k=>!['markdown','entityKey'].includes(k))||typeof data.markdown!=='string'||data.markdown.length>500000)throw bad();const m=/^(`{3,})([A-Za-z0-9_+-]{0,40})\r?\n([\s\S]*)\r?\n\1(?:\r?\n)?$/.exec(data.markdown);if(!m)throw unsupported();return{type:'pre',text:m[3],...(m[2]?{language:m[2]}:{})};}
function videoNodes(poster:string|undefined,source:string,isPoster:boolean):XCaptureNode[]{if(!xPublicAddress(source))throw bad();return[...(poster?[{type:'image',url:poster,alt:'视频预览（视频未下载）',...(isPoster?{poster:true}:{})}]:[]),{type:'paragraph',children:[{type:'text',text:'视频未下载，'},{type:'link',url:source,children:[{type:'text',text:'在原站播放'}]}]}];}
export function adaptXPublicPost(input:unknown,source:string):XArticleCapture{
 const address=xPublicAddress(source);if(!address||!record(input)||input.code!==200||!record(input.status))throw bad();const status=input.status;
 if(status.id!==address.id||!record(status.author)||typeof status.author.screen_name!=='string'||!/^\w{1,15}$/.test(status.author.screen_name)||status.author.protected===true||address.handle&&address.handle.toLowerCase()!==status.author.screen_name.toLowerCase())throw bad();
 if(status.article!==undefined&&status.article!==null)return adaptXPublicArticle(input,source);if(address.kind==='article')throw bad();
 let chars=0,mediaCount=0;const seen=new Set<string>();
 function content(s:Record<string,any>,depth=0):XCaptureNode[]{
  if(!digits(s.id)||!xPublicAddress(s.url)||xPublicAddress(s.url)!.id!==s.id)throw bad();const ownSource=xPublicAddress(s.url)!.url;
  if(s.type==='tombstone')return[{type:'paragraph',children:[{type:'text',text:'引用帖子不可用，未取得正文。'},{type:'link',url:ownSource,children:[{type:'text',text:'查看原帖'}]}]}];
  if(typeof s.text!=='string'||!s.text.trim()||!record(s.author)||typeof s.author.screen_name!=='string'||!/^\w{1,15}$/.test(s.author.screen_name)||s.author.protected===true||xPublicAddress(s.url)?.handle&&xPublicAddress(s.url)!.handle!.toLowerCase()!==s.author.screen_name.toLowerCase())throw bad();chars+=s.text.length;if(chars>500000)throw new WebError('内容超过保存预算。','x_quote_budget');
  if(seen.has(s.id))return[{type:'paragraph',children:[{type:'link',url:ownSource,children:[{type:'text',text:'重复引用，查看原帖'}]}]}];seen.add(s.id);
  const raw=record(s.raw_text)&&typeof s.raw_text.text==='string'?s.raw_text.text:s.text;if(raw!==s.text)throw bad();const facets=record(s.raw_text)&&Array.isArray(s.raw_text.facets)?s.raw_text.facets:[];if(facets.length>2000)throw bad();
  const spans:Array<{start:number;end:number;type:string;url?:string}>=[];
  for(const f of facets){if(!record(f)||!['url','media','bold','italic','mention','hashtag'].includes(f.type)||!Array.isArray(f.indices)||f.indices.length!==2||!f.indices.every(Number.isSafeInteger)||f.indices[0]<0||f.indices[1]<=f.indices[0]||f.indices[1]>raw.length)throw bad();for(const p of f.indices)if(p>0&&p<raw.length&&/[\uD800-\uDBFF]/.test(raw[p-1])&&/[\uDC00-\uDFFF]/.test(raw[p]))throw bad();
   if(f.type==='media')continue;
   if(f.type==='url'){if(typeof f.original!=='string'||raw.slice(...f.indices)!==f.original)continue;const href=safeWebUrl(f.replacement);if(!href)throw bad();spans.push({start:f.indices[0],end:f.indices[1],type:'link',url:href});}
   else if(['bold','italic'].includes(f.type))spans.push({start:f.indices[0],end:f.indices[1],type:f.type==='bold'?'strong':'em'});
  }
  const links=spans.filter(s=>s.type==='link').sort((a,b)=>a.start-b.start);for(let i=1;i<links.length;i++)if(links[i].start<links[i-1].end)throw bad();
  const out:XCaptureNode[]=[],points=[...new Set([0,raw.length,...spans.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b);if(points.length>2001)throw bad();let line:XCaptureNode[]=[];
  for(let i=0;i<points.length-1;i++){const start=points[i],end=points[i+1];let n:XCaptureNode={type:'text',text:raw.slice(start,end),preserveBreaks:true};for(const type of['em','strong'])if(spans.some(s=>s.type===type&&s.start<=start&&s.end>=end))n={type,children:[n]};const link=links.find(s=>s.start<=start&&s.end>=end);if(link)n={type:'link',url:link.url,children:[n]};line.push(n);}out.push({type:'paragraph',children:line});
  if(s.media!=null&&!record(s.media))throw bad();if(s.media&&Object.keys(s.media).length&&(!Array.isArray(s.media.all)||s.media.all.length===0&&['photos','videos'].some(key=>Array.isArray(s.media[key])&&s.media[key].length)))throw bad();const media=s.media?.all??[];if(!Array.isArray(media))throw bad();if(media.length>100)throw new WebError('引用媒体超过保存预算。','x_quote_budget');const mediaIds=new Set<string>();
  for(const m of media){if(!record(m)||!digits(m.id)||!['photo','video','gif'].includes(m.type))throw bad();if(mediaIds.has(m.id))continue;mediaIds.add(m.id);if(++mediaCount>100)throw new WebError('引用媒体超过保存预算。','x_quote_budget');if(m.type==='photo'){const u=xMediaUrl(m.url);u.searchParams.set('name','orig');out.push({type:'image',url:u.href,alt:'帖子图片'});}else{let poster:string|undefined;if(m.thumbnail_url!=null){const u=xPosterUrl(m.thumbnail_url);u.searchParams.set('name','orig');poster=u.href;}out.push(...videoNodes(poster,ownSource,true));}}
  for(const f of facets)if(f.type==='media'&&(!digits(f.id)||!mediaIds.has(f.id)))throw bad();
  if(s.replying_to){const reply=xPublicAddress(s.replying_to.url??s.replying_to);out.push({type:'paragraph',children:[{type:'text',text:'此处仅保存本帖，回复前文未自动读取。'},...(reply?[{type:'link',url:reply.url,children:[{type:'text',text:'查看回复前文'}]}]:[])]});}
  if(s.quote){if(!record(s.quote))throw bad();if(depth>=2){const q=xPublicAddress(s.quote.url);out.push({type:'paragraph',children:[{type:'text',text:'更深引用未读取。'},...(q?[{type:'link',url:q.url,children:[{type:'text',text:'查看原帖'}]}]:[])]});}else{const author=s.quote.author?.screen_name,checkpoint={chars,mediaCount,seen:new Set(seen)};try{const nested=content(s.quote,depth+1),quote:XCaptureNode={type:'quote',children:[{type:'paragraph',children:[{type:'text',text:author?`引用 @${author}：`:'引用：'}]},...nested]};const count=(ns:XCaptureNode[]):number=>ns.reduce((n,v)=>n+1+(v.children?count(v.children):0),0);const textSize=(ns:XCaptureNode[]):number=>ns.reduce((n,v)=>n+(v.text?.length??0)+(v.children?textSize(v.children):0),0);if(count(out)+count([quote])>2000||textSize(out)+textSize([quote])>500000)throw new WebError('引用节点超过保存预算。','x_quote_budget');out.push(quote);}catch(error){if(!(error instanceof WebError)||error.code!=='x_quote_budget')throw error;chars=checkpoint.chars;mediaCount=checkpoint.mediaCount;seen.clear();for(const id of checkpoint.seen)seen.add(id);const target=xPublicAddress(s.quote.url);if(!target)throw bad();out.push({type:'paragraph',children:[{type:'text',text:'引用内容超出保存范围，未保存其正文或媒体。'},{type:'link',url:target.url,children:[{type:'text',text:'在原站查看引用'}]}]});}}}
  return out;
 }
 const nodes=content(status),title=`@${status.author.screen_name} · ${status.text.split(/\r?\n/)[0].slice(0,70)}`;return parseXPublicContent({url:address.url,title,nodes});
}
export async function extractPublicXArticle(source:string,options:{signal:AbortSignal;progress?:(s:string)=>void;fetcher?:(url:string,maxBytes:number,budget:WebBudget)=>Promise<FetchedWeb>}):Promise<ExtractedWeb>{
 const address=xPublicAddress(source);if(!address)throw bad();const budget={requests:0,bytes:0};options.progress?.('通过 FxTwitter 公开接口读取 X 内容…');
 async function get(expected:string){const page=await(options.fetcher??((url,maxBytes,budget)=>fetchWeb(url,{signal:options.signal,maxBytes,budget,validateUrl:u=>validateFixedEndpoint(u,expected)})))(expected,2*1024*1024,budget);validateFixedEndpoint(page.url,expected);options.signal.throwIfAborted();if(page.bytes.length>2*1024*1024||!/^application\/json(?:;|$)/.test(page.type))throw bad();try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(page.bytes));}catch{throw bad();}}
 let endpoint=xPublicEndpoint(source).href,response:any,profileIdentity:{statusId:string;articleId:string;handle:string}|undefined;
 try{response=await get(endpoint);if(response?.code===404)throw new WebError('内容不可用。','web_unavailable');}
 catch(error){options.signal.throwIfAborted();if(address.kind!=='article'||!(error instanceof WebError)||error.code!=='web_unavailable')throw error;if(!address.handle)throw new WebError('无法关联这个文章内部 ID，请使用原帖的分享链接。','x_article_unresolved');
  const profile=`https://api.fxtwitter.com/2/profile/${address.handle}/articles?count=20`,list=await get(profile);if(!record(list)||list.code!==200||!Array.isArray(list.results)||list.results.length>20)throw new WebError('文章定位只支持一次最多20个候选，请使用原帖分享链接。','x_article_locator');
  const matches=list.results.filter((s:any)=>record(s)&&record(s.author)&&typeof s.author.screen_name==='string'&&s.author.screen_name.toLowerCase()===address.handle!.toLowerCase()&&record(s.article)&&s.article.id===address.id&&digits(s.id)&&record(s.article.content)&&xPublicAddress(s.url)?.id===s.id&&xPublicAddress(s.url)?.handle?.toLowerCase()===address.handle!.toLowerCase());if(matches.length!==1)throw new WebError('未在有限公开候选中找到唯一关联，请使用原帖分享链接。','x_article_unresolved');endpoint=`https://api.fxtwitter.com/2/status/${matches[0].id}`;response=await get(endpoint);if(!record(response)||response.code!==200||!record(response.status)||response.status.id!==matches[0].id||response.status.article?.id!==address.id||response.status.author?.screen_name?.toLowerCase()!==address.handle.toLowerCase())throw bad();profileIdentity={statusId:response.status.id,articleId:response.status.article.id,handle:response.status.author.screen_name};
 }
 const resolved=endpoint.split('/').at(-1)!,capture=resolved===address.id?adaptXPublicPost(response,source):adaptXPublicArticle(response,source,resolved,!!profileIdentity),identity=profileIdentity??provenIdentity(response.status);
 return extractXArticle(capture,{signal:options.signal,progress:options.progress,budget,retrieval:{kind:'public-service',provider:'fxtwitter',url:endpoint},...(identity?{identity}:{}),fetcher:options.fetcher});
}
function validateFixedEndpoint(input:string,expected:string){if(input!==expected||!/^https:\/\/api\.fxtwitter\.com\/2\/(?:status\/\d{1,30}|profile\/[A-Za-z0-9_]{1,15}\/articles\?count=20)$/.test(input))throw new WebError('公开接口跳转离开批准目标。','x_public_endpoint');return new URL(input);}
