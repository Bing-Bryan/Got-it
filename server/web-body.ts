import type {DefaultTreeAdapterMap as Tree} from 'parse5';
import {WebError} from './web-fetch';
type Node=Tree['node'];
export const nodeAttr=(n:Node,key:string)=>'attrs'in n?n.attrs.find(a=>a.name===key)?.value??'':'';
const children=(n:Node)=>'childNodes'in n?n.childNodes:[];
export const nodes=(n:Node,p:(n:Node)=>boolean):Node[]=>[...(p(n)?[n]:[]),...children(n).flatMap(c=>nodes(c,p))];
function hidden(n:Node):boolean{
 return 'tagName'in n&&(n.attrs.some(a=>a.name==='hidden')||nodeAttr(n,'aria-hidden')==='true'&&n.tagName!=='svg'||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/i.test(nodeAttr(n,'style')));
}
function gateExcluded(n:Node):boolean{return hidden(n)||'tagName'in n&&['script','style','noscript','template'].includes(n.tagName);}
export function excluded(n:Node):boolean{
 if(!('tagName'in n))return false;
 return gateExcluded(n)||['nav','footer','aside','button','input','select','textarea'].includes(n.tagName)||/(?:^|[ _-])(?:entryFooter|post-footer|recent-articles|related-posts|recommended|share-buttons|post-meta|author-bio)(?:$|[ _-])/.test(nodeAttr(n,'class'));
}
export const visibleText=(n:Node):string=>excluded(n)?'':n.nodeName==='#text'?(n as Tree['textNode']).value:children(n).map(visibleText).join('');
const normal=(s:string)=>s.replace(/\s+/g,' ').trim();
function visibleNodes(n:Node,p:(n:Node)=>boolean):Node[]{return excluded(n)?[]:[...(p(n)?[n]:[]),...children(n).flatMap(c=>visibleNodes(c,p))];}
function quality(n:Node){const prose=visibleNodes(n,c=>'tagName'in c&&c.tagName==='p').map(visibleText).map(normal).filter(s=>s.length>=40);const chars=normal(visibleText(n)).length;const links=visibleNodes(n,c=>'tagName'in c&&c.tagName==='a').map(visibleText).join('').length;return{prose:prose.length,chars,score:prose.reduce((a,s)=>a+s.length,0)-links};}
const depth=(n:Node)=>{let d=0;for(let p:Node|undefined=n;p&&'parentNode'in p&&p.parentNode;p=p.parentNode as Node)d++;return d;};
// Fallback for pages without semantic containers (common on Chinese media sites): the deepest
// element that still holds nearly all article prose. Thresholds and the rival check mirror the
// semantic path, so link-heavy lists or comment blocks are not mistaken for the article.
function proseContainer(root:Node):Node|undefined{
 const scored=visibleNodes(root,n=>'tagName'in n&&['div','section','td'].includes(n.tagName)).map(n=>({n,...quality(n)})).filter(c=>c.prose>=2&&c.chars>=300&&c.score>200);
 if(!scored.length)return undefined;
 const best=Math.max(...scored.map(c=>c.score));
 const chosen=scored.filter(c=>c.score>=best*.9).sort((a,b)=>depth(b.n)-depth(a.n))[0];
 const nested=(a:Node,b:Node)=>nodes(a,x=>x===b).length>0;
 if(scored.some(c=>c.n!==chosen.n&&c.score>best*.8&&!nested(chosen.n,c.n)&&!nested(c.n,chosen.n)))throw new WebError('页面存在多个相近的正文区域，无法确定完整文章。','web_structure');
 return chosen.n;
}
// The title usually sits just before a fallback container: the last visible h1 preceding it.
function headingBefore(root:Node,container:Node):Node|undefined{
 const order=visibleNodes(root,()=>true),at=order.indexOf(container);
 return order.slice(0,at).filter(n=>'tagName'in n&&n.tagName==='h1'&&!!normal(visibleText(n))).at(-1)
  ??visibleNodes(container,n=>'tagName'in n&&/^h[12]$/.test(n.tagName)&&!!normal(visibleText(n)))[0];
}
export function genericArticle(root:Node):{article:Node,body:Node,heading:Node,publicExcerpt:boolean}{
 const candidates=visibleNodes(root,n=>'tagName'in n&&(['article','main'].includes(n.tagName)||nodeAttr(n,'role')==='main'||/(?:^|\s)(?:entry|post|article|h-entry)(?:$|\s)/.test(nodeAttr(n,'class'))));
 const articles=candidates.filter(n=>'tagName'in n&&n.tagName==='article');
 const pool=articles.length?articles:candidates;
 const ranked=pool.map(n=>({n,...quality(n)})).filter(c=>c.prose>=2&&c.chars>=300&&c.score>200).sort((a,b)=>b.score-a.score);
 const fallback=!ranked.length?proseContainer(root):undefined;
 if(!ranked.length&&!fallback||ranked.length>1&&ranked[1].score>ranked[0].score*.8&&!nodes(ranked[0].n,n=>n===ranked[1].n).length)throw new WebError('无法确定完整的静态文章正文；可能需要网页程序或登录。','web_structure');
 const article=fallback??ranked[0].n;
 // A subscriber footer alone is not a paywall: require a visible article-scoped access gate.
 // Access-gate discovery intentionally retains visible controls;正文过滤 still excludes them.
 const gateNodes=(n:Node):Node[]=>gateExcluded(n)?[]:[n,...children(n).flatMap(gateNodes)];
 const gateText=(n:Node):string=>gateExcluded(n)?'':n.nodeName==='#text'?(n as Tree['textNode']).value:children(n).map(gateText).join('');
 const flow=gateNodes(article);
 const markedGate=(n:Node)=>/(?:^|[\s_-])(?:paywall|subscription-wall|subscriber-only)(?:$|[\s_-])/i.test(nodeAttr(n,'class')+' '+nodeAttr(n,'id'));
 const accessCopy=(s:string)=>/this post is for paid subscribers|(?:read|unlock|continue).{0,45}(?:paid subscribers|subscribe)|仅(?:限)?付费|订阅后(?:阅读|继续)/i.test(s);
 const plainAccessCopy=(s:string)=>/^(?:subscribe(?: now)? to (?:continue|keep) reading(?: (?:(?:this|the) (?:article|story|post)|(?:the )?(?:rest|remainder) of (?:this|the) (?:article|story|post)|the full (?:article|story|post)))?|(?:sign|log) in to (?:continue|keep) reading(?: (?:(?:this|the) (?:article|story|post)|(?:the )?(?:rest|remainder) of (?:this|the) (?:article|story|post)|the full (?:article|story|post)))?|(?:continue|keep) reading(?: (?:(?:this|the) (?:article|story|post)|(?:the )?(?:rest|remainder) of (?:this|the) (?:article|story|post)|the full (?:article|story|post)))? (?:by )?(?:subscribing|signing in|logging in)|订阅后继续阅读(?:本文|全文)?)[.!。…]*$/i.test(s);
 const inEditorialOrFooterContext=(n:Node)=>{for(let p:Node|undefined=n;p&&p!==article;p='parentNode'in p?p.parentNode as Node:undefined){if('tagName'in p&&['p','blockquote','q','figure','figcaption','table','li','footer','nav','aside'].includes(p.tagName))return true;if(/(?:^|[\s_-])(?:newsletter|signup|sign-up|post-footer|entry-footer|quote|citation)(?:$|[\s_-])/i.test(nodeAttr(p,'class')+' '+nodeAttr(p,'id')))return true;}return false;};
 const precedingProse=(n:Node)=>flow.slice(0,flow.indexOf(n)).filter(p=>'tagName'in p&&p.tagName==='p'&&normal(gateText(p)).length>=40).length;
 const inferredGate=(n:Node)=>'tagName'in n&&['div','section','form','dialog','button','a'].includes(n.tagName)&&normal(gateText(n)).length<=180&&plainAccessCopy(normal(gateText(n)))&&!inEditorialOrFooterContext(n)&&precedingProse(n)>=2;
 const loginCopy=(s:string)=>/(?:(?:sign|log)(?:ging|ning)? in.{0,80}(?:read|article|story|post)|(?:read|article|story|post).{0,80}(?:sign|log)(?:ging|ning)? in)/i.test(s);
 const inferredLogin=(n:Node)=>'tagName'in n&&['div','section','form','dialog','button','a'].includes(n.tagName)&&normal(gateText(n)).length<=180&&plainAccessCopy(normal(gateText(n)).replace(/^please\s+/i,''))&&!inEditorialOrFooterContext(n);
 const gate=flow.find(n=>(markedGate(n)&&!inEditorialOrFooterContext(n)&&(accessCopy(normal(gateText(n)))||loginCopy(normal(gateText(n)))))||inferredGate(n)||inferredLogin(n));
 // A paid gate may offer sign-in to existing subscribers; a login-only gate is not public-excerpt permission.
 if(gate&&loginCopy(normal(gateText(gate)))&&!accessCopy(normal(gateText(gate))))throw new WebError('这篇文章需要登录，无法读取可靠的公开正文。','web_paywall');
 if(gate){
  function cutBefore(n:Node):boolean{const list=children(n);for(let i=0;i<list.length;i++){if(list[i]===gate){if('childNodes'in n)n.childNodes=list.slice(0,i);return true;}if(cutBefore(list[i])){if('childNodes'in n)n.childNodes=list.slice(0,i+1);return true;}}return false;}
  if(gate===article||!cutBefore(article))throw new WebError('无法确定可靠的公开正文边界。','web_structure');
 }

 const bodies=visibleNodes(article,n=>nodeAttr(n,'itemprop').split(/\s+/).includes('articleBody')||/(?:^|\s)(?:post-content|entry-content|article-content|article-body|post-body|body markup)(?:$|\s)/.test(nodeAttr(n,'class'))).filter(n=>quality(n).prose>=2);
 const outerBodies=bodies.filter(n=>!bodies.some(other=>other!==n&&nodes(other,c=>c===n).length));
 if(outerBodies.length>1)throw new WebError('文章存在多个独立正文容器，无法确定完整内容。','web_structure');
 const body=outerBodies[0]??article;
 if(quality(body).prose<2||quality(body).chars<300)throw new WebError('付费门槛之前没有足够可靠的公开正文。','web_structure');
 const heading=fallback?headingBefore(root,fallback):visibleNodes(article,n=>'tagName'in n&&n.tagName==='h1'&&!!normal(visibleText(n)))[0]??visibleNodes(article,n=>'tagName'in n&&n.tagName==='h2'&&!!normal(visibleText(n)))[0];
 if(!heading||/^(?:sign in|log in|404|access denied|error|not found|just a moment|attention required)\b/i.test(normal(visibleText(heading))))throw new WebError('页面不是可读取的公开静态文章。','web_structure');
 return{article,body,heading,publicExcerpt:!!gate};
}
