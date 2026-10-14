import {normalizeXArticleUrl} from '../src/lib/x-article-url';
import {extractPublicXArticle} from './x-article-public';
import { parse, serializeOuter, type DefaultTreeAdapterMap as Tree } from 'parse5';
import { randomUUID, createHash } from 'node:crypto';
import { createInitialWorkspace } from '../src/sample';
import type { Workspace } from '../src/types';
import { safeWebUrl } from '../src/lib/web-data';
import type { WebMedia, WebFragment } from '../src/lib/web-data';
import { fetchWeb, WEB_LIMITS, WebError, type FetchedWeb, type WebBudget } from './web-fetch';
import { sanitizeStaticSvg, validateStaticImage, type ValidImage } from './web-media';
import { articleUrl, mediaUrl, sourceImageUrl } from './web-sites';
import {genericArticle, excluded} from './web-body';
export const CLAUDE_ARTICLES=new Set(['/blog/building-effective-agent-automations/','/blog/automating-eval-design-and-hillclimbing/']);
// Source light-theme values researched 2026-10-10. No CSS/font fetch is performed at import time.
const CLAUDE_PALETTE={'--bg':'#faf9f5','--ink':'#141413','--line':'#14141338','--line-soft':'#1414131c','--viz-muted':'#65645e','--viz-m1':'#3d3d3a','--fig-focal':'#c15f3c'};
export interface ExtractedWeb {workspace:Workspace;resources:Map<string,ValidImage>}
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const attr=(n:Tree['node'],key:string)=>'attrs'in n?n.attrs.find(a=>a.name===key)?.value??'':'';
const text=(n:Tree['node']):string=>n.nodeName==='#text'?(n as Tree['textNode']).value:'childNodes'in n?n.childNodes.map(text).join(''):'';
const children=(n:Tree['node'])=>'childNodes'in n?n.childNodes:[];
const find=(n:Tree['node'],test:(n:Tree['node'])=>boolean):Tree['node']|undefined=>test(n)?n:children(n).map(c=>find(c,test)).find(Boolean);
const all=(n:Tree['node'],test:(n:Tree['node'])=>boolean):Tree['node'][]=>[...(test(n)?[n]:[]),...children(n).flatMap(c=>all(c,test))];
const esc=(s:string)=>s.replace(/[\\`*_[\]<>]/g,c=>'\\'+c);
const normal=(s:string)=>s.replace(/\s+/g,' ').trim();
export async function extractWeb(input:string,options:{signal:AbortSignal;fetcher?:(url:string,maxBytes:number,budget:WebBudget)=>Promise<FetchedWeb>;progress?:(message:string)=>void}):Promise<ExtractedWeb>{
 const original=articleUrl(input);
 if(normalizeXArticleUrl(original.href))return extractPublicXArticle(original.href,options);
 const budget={requests:0,bytes:0};const fetcher=options.fetcher??((url,maxBytes,budget)=>fetchWeb(url,{signal:options.signal,maxBytes,budget,validateUrl:maxBytes===WEB_LIMITS.htmlBytes?articleUrl:mediaUrl}));
 options.progress?.('读取文章正文…');const page=await fetcher(original.href,WEB_LIMITS.htmlBytes,budget);options.signal.throwIfAborted();
 const final=articleUrl(page.url);
 if(!/^(text\/html|application\/xhtml\+xml)(;|$)/.test(page.type))throw new WebError('链接不是支持的静态文章；PDF 请使用添加文件。','web_type');
 const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(page.type)?.[1]??'utf-8';let html:string;try{html=new TextDecoder(charset,{fatal:true}).decode(page.bytes)}catch{throw new WebError('网页字符编码无法读取。');}
 const root=parse(html),anthropic=final.hostname==='www.anthropic.com'&&final.pathname.startsWith('/research/'),claude=final.hostname==='claude.dev'&&final.pathname.startsWith('/blog/');
 const generic=!anthropic&&!claude?genericArticle(root):undefined;
 const main=anthropic&&find(root,n=>'tagName'in n&&n.tagName==='main'&&attr(n,'id')==='main-content');
 const article=generic?.article??(anthropic?(main&&find(main,n=>'tagName'in n&&n.tagName==='article')):find(root,n=>attr(n,'data-tpl')==='article'));
 const bodies=article?all(article,n=>anthropic?attr(n,'class').split(/\s+/).some(c=>/^Body-module-.*__body$/.test(c)):attr(n,'id')==='body'&&attr(n,'class').split(/\s+/).includes('prose')):[];
 const body=generic?.body??(bodies.length===1?bodies[0]:undefined),heading=generic?.heading??(article&&find(article,n=>'tagName'in n&&n.tagName==='h1'));
 const outsideImages=anthropic&&article&&body?all(article,n=>'tagName'in n&&n.tagName==='img').filter(n=>!all(body,c=>c===n).length):[];
 const hero=outsideImages.filter(n=>attr(n,'class').split(/\s+/).some(c=>/^PostDetail-module-.*__heroImage$/.test(c)));
 const title=heading&&normal(text(heading));
 if(!article||!body||!title||hero.length>1||outsideImages.some(n=>!hero.includes(n))||/^(?:sign in|log in|404|access denied|error|not found)\b/i.test(title)||normal(text(body)).length<300||all(body,n=>'tagName'in n&&n.tagName==='p').length<2||!generic&&!all(body,n=>'tagName'in n&&/^h[2-6]$/.test(n.tagName)).length)throw new WebError('文章正文结构已变化或内容不完整，无法生成有效预览。','web_structure');
 const media:WebMedia[]=[],resources=new Map<string,ValidImage>(),fragments:WebFragment[]=[];let headingIndex=0,totalMedia=0;
 if(attr(heading!,'id'))fragments.push({fragment:attr(heading!,'id'),headingIndex:0});
 function fragment(n:Tree['node'],index:number){const id=attr(n,'id');if(id&&!fragments.some(f=>f.fragment===id))fragments.push({fragment:id,headingIndex:index});}
 async function medium(n:Tree['node'],kind:'image'|'svg',alt:string):Promise<string>{
  options.signal.throwIfAborted();if(media.length>=WEB_LIMITS.mediaCount)throw new WebError('正文媒体数量超过限制。','web_budget');
  const item:WebMedia={id:randomUUID(),kind,status:'missing',alt:alt.slice(0,4000)};media.push(item);options.progress?.(`读取静态图片／图表 ${media.length}…`);
  try{
   let image:ValidImage;
   if(kind==='svg')image=sanitizeStaticSvg(serializeOuter(n as Tree['element']),CLAUDE_PALETTE);
   else{
    const raw=attr(n,'data-src')||attr(n,'data-lazy-src')||attr(n,'src')||attr(n,'srcset').split(',')[0]?.trim().split(/\s/)[0];
    if(!raw)throw new WebError('图片地址缺失。');const fetched=await fetcher(sourceImageUrl(raw,final).href,WEB_LIMITS.imageBytes,budget);mediaUrl(fetched.url);image=await validateStaticImage(fetched.bytes);if(fetched.type.split(';')[0].trim()!==image.mime)throw new WebError('图片响应类型与实际格式不一致。','web_image');
   }
   options.signal.throwIfAborted();totalMedia+=image.bytes.length;if(totalMedia>WEB_LIMITS.mediaBytes)throw new WebError('正文媒体总容量超过限制。','web_budget');
   const id=sha(image.bytes);resources.set(id,image);Object.assign(item,{status:'saved',resourceId:id,mime:image.mime,bytes:image.bytes.length,width:image.width,height:image.height});
  }catch(error){
   options.signal.throwIfAborted();if(error instanceof WebError&&error.code==='web_budget')throw error;
   item.status=error instanceof WebError&&error.code==='web_unsupported'?'unsupported':'missing';item.reason=error instanceof WebError?error.message:'图片暂时无法读取。';
  }
  return `\n\n![${esc(item.alt)}](got-it-media:${item.id})\n\n`;
 }
 async function walk(n:Tree['node']):Promise<string>{
  options.signal.throwIfAborted();if(n.nodeName==='#text')return esc((n as Tree['textNode']).value);if(!('tagName'in n))return '';
  const tag=n.tagName;
  if(n===heading||excluded(n))return '';
  if(generic&&/(?:^|[ _-])(?:related-posts|recommended|share-buttons|post-meta|author-bio)(?:$|[ _-])/.test(attr(n,'class')))return '';
  if(tag==='svg'){if(attr(n,'class').split(/\s+/).includes('art-diagram-narrow')&&children(n.parentNode as Tree['node']).some(c=>attr(c,'class').split(/\s+/).includes('art-diagram-wide')))return '';return medium(n,'svg',attr(n.parentNode as Tree['node'],'aria-label')||'静态图表');}
  if(tag==='img')return medium(n,'image',attr(n,'alt'));
  if(['video','audio','canvas','iframe','object','embed'].includes(tag)){if(media.length>=WEB_LIMITS.mediaCount)throw new WebError('正文媒体数量超过限制。','web_budget');const item:WebMedia={id:randomUUID(),kind:'image',status:'unsupported',alt:'未导入的动态内容',reason:'首版不支持视频、动画或需要网页程序的图表。'};media.push(item);return `\n\n![${item.alt}](got-it-media:${item.id})\n\n`;}
  if(tag==='pre'){const raw=text(n).replace(/^\n/,'').replace(/\n$/,'');const code=find(n,c=>'tagName'in c&&c.tagName==='code');const lang=/language-([\w+-]+)/.exec(attr(code??n,'class'))?.[1]??attr(n,'data-language');const fence='`'.repeat(Math.max(3,...[...raw.matchAll(/`+/g)].map(m=>m[0].length+1)));return `\n\n${fence}${lang}\n${raw}\n${fence}\n\n`;}
  if(tag==='code'){const raw=text(n),fence='`'.repeat(Math.max(1,...[...raw.matchAll(/`+/g)].map(m=>m[0].length+1)));return `${fence} ${raw} ${fence}`;}
  if(/^h[1-6]$/.test(tag)){headingIndex++;fragment(n,headingIndex);return `\n\n${'#'.repeat(Number(tag[1]))} ${normal(await sequential(n))}\n\n`;}
  if(tag==='section'){fragment(n,headingIndex+1);}
  if(tag==='a'){const mediaBefore=media.length;const content=await sequential(n);if(media.length>mediaBefore)return content;try{const u=new URL(attr(n,'href'),final);if(!safeWebUrl(u.href))return content;return `[${content}](<${u.href.replace(/[<>]/g,'')}>)`;}catch{return content;}}
  if(tag==='table'){
   const rows=all(n,c=>'tagName'in c&&c.tagName==='tr').map(r=>children(r).filter(c=>'tagName'in c&&['th','td'].includes(c.tagName)));if(!rows.length)return '';
   const cells:string[][]=[];for(const row of rows){const values:string[]=[];for(const cell of row)values.push(normal(await sequential(cell)).replace(/\|/g,'\\|'));cells.push(values);}const count=Math.max(...cells.map(c=>c.length));const row=(r:string[])=>'| '+Array.from({length:count},(_,i)=>r[i]??'').join(' | ')+' |';return '\n\n'+row(cells[0])+'\n'+row(Array(count).fill('---'))+'\n'+cells.slice(1).map(row).join('\n')+'\n\n';
  }
  if(tag==='ul'||tag==='ol'){let out='';const items=n.childNodes.filter(c=>'tagName'in c&&c.tagName==='li');for(let i=0;i<items.length;i++){const item=await sequential(items[i]);const prefix=tag==='ol'?`${i+1}. `:'- ';out+=prefix+item.trim().split('\n').map((line,j)=>j?' '.repeat(prefix.length)+line:line).join('\n')+'\n';}return '\n\n'+out+'\n\n';}
  const content=await sequential(n);
  if(tag==='br')return '  \n';if(tag==='hr')return '\n\n---\n\n';if(tag==='strong'||tag==='b')return '**'+content+'**'+(/^FIG(?:URE)?\s*\d+$/i.test(normal(text(n)))?' ':'');if(tag==='em'||tag==='i')return '*'+content+'*';
  if(tag==='li')return '\n'+content.trim().replace(/\n\n/g,'\n  ');

  if(tag==='blockquote')return '\n\n'+content.trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
  return ['p','div','figure','figcaption','section','details','summary'].includes(tag)?'\n\n'+content+'\n\n':content;
 }
 // Sequential traversal ensures headings/media follow source order, independent of response timing.
 async function sequential(n:Tree['node']):Promise<string>{let out='';for(const c of children(n))out+=await walk(c);return out;}
 const markdown=('# '+esc(title)+'\n\n'+(hero.length?await walk(hero[0]):'')+await sequential(body)).trim()+'\n';
 const coverage=generic?.publicExcerpt?{coverage:'public-excerpt' as const,coverageReason:'paywall' as const}:{};
 const importedAt=new Date().toISOString(),web={version:1 as const,originalUrl:original.href,finalUrl:final.href,extractorVersion:generic?'generic-static-v1':anthropic?'anthropic-static-v1':'claude-static-v2',contentVersion:sha(JSON.stringify(generic?.publicExcerpt?[markdown,media,fragments,coverage]:[markdown,media,fragments])),media,fragments,...coverage};
 return{workspace:{...createInitialWorkspace(),document:{kind:'web',id:randomUUID(),filename:title,markdown,web,contentHash:web.contentVersion,importedAt,isDemo:false},updatedAt:importedAt,hasUnexportedChanges:false},resources};
}
