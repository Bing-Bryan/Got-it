import { projectWebAnchor,parseWebAnchorProjection,type WebAnchorProjection } from '../src/lib/web-anchor-compat';
import {combineBookmarkAnchors,type BookmarkAnchor} from '../src/lib/bookmark-types';
import { marked } from 'marked';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { stableHash } from '../src/sample';
import { buildTranslationSource, renderTranslatedHtml } from '../src/lib/web-translation';
import type { Workspace, Anchor } from '../src/types';
const excludedTextNodes=new Set(['script','style','iframe','object','embed','svg','video','audio','source','link','meta']);
const tags=new Set(['h1','h2','h3','h4','h5','h6','p','li','pre','td','th']);
type Node=DefaultTreeAdapterMap['node'];
function text(node:Node):string {if(node.nodeName==='#text')return (node as DefaultTreeAdapterMap['textNode']).value;if(excludedTextNodes.has(node.nodeName))return '';return 'childNodes'in node?node.childNodes.map(text).join(''):'';}
function walk(node:Node,visit:(n:Node)=>void){if(excludedTextNodes.has(node.nodeName))return;visit(node);if('childNodes'in node)node.childNodes.forEach(c=>walk(c,visit));}
function hasBlockAncestor(node:Node,explicit:boolean){let parent='parentNode'in node?node.parentNode:null;while(parent){if(explicit?'attrs'in parent&&parent.attrs.some(a=>a.name==='data-block-id'):tags.has(parent.nodeName))return true;parent='parentNode'in parent?parent.parentNode:null;}return false;}
export function bookmarkSourceBlocks(workspace:Workspace,translated=false,rootsOnly=false):Map<string,string> {
  if(workspace.document.kind==='pdf')return new Map();
  if(workspace.document.kind==='web'){
    const source=buildTranslationSource(workspace.document.markdown,workspace.document.web);
    if(!translated&&!rootsOnly)return new Map(source.blocks.map(b=>[b.id,b.text]));
    const blocks=new Map<string,string>();const tree=parseFragment(translated?renderTranslatedHtml(source,workspace.webTranslation?.units??{}):source.html);
    walk(tree,n=>{if('attrs'in n){const id=n.attrs.find(a=>a.name==='data-block-id')?.value;if(id&&(!rootsOnly||!hasBlockAncestor(n,true)))blocks.set(id,translated?text(n):(source.blocks.find(b=>b.id===id)?.text??text(n)));}});return blocks;
  }
  const tree=parseFragment(marked.parse(workspace.document.markdown,{async:false,gfm:true,breaks:false}) as string),blocks=new Map<string,string>();let index=0;
  walk(tree,n=>{if(!tags.has(n.nodeName))return;const raw=text(n),clean=raw.replace(/\s+/g,' ').trim(),id=`block-${index++}-${stableHash(`${n.nodeName}:${clean}`).slice(0,7)}`;
    // Rendered ==markers== are removed outside code/pre, after block IDs are assigned.
    const visible=(node:Node,code=false):string=>{if(excludedTextNodes.has(node.nodeName))return '';if(node.nodeName==='#text'){const s=(node as DefaultTreeAdapterMap['textNode']).value;return code?s:s.replace(/==([^=\n]+)==/g,'$1');}return 'childNodes'in node?node.childNodes.map(c=>visible(c,code||node.nodeName==='code'||node.nodeName==='pre')).join(''):'';};
    if(!rootsOnly||!hasBlockAncestor(n,false))blocks.set(id,visible(n));});return blocks;
}
export function exactBookmarkRange(block:string|undefined,anchor:Pick<Anchor,'start'|'end'|'quote'>&Partial<Pick<Anchor,'prefix'|'suffix'>>){return typeof block==='string'&&block.slice(anchor.start,anchor.end)===anchor.quote&&(anchor.prefix===undefined||block.slice(Math.max(0,anchor.start-anchor.prefix.length),anchor.start)===anchor.prefix)&&(anchor.suffix===undefined||block.slice(anchor.end,anchor.end+anchor.suffix.length)===anchor.suffix);}

/** Compare only already-authorized PDF/native or existing OCR text; never runs OCR. */
export async function verifyPdfBookmarkText(library:import('./reading-library').ReadingLibrary,entryId:string,anchor:Anchor){
  const location=anchor.pdf!;
  const overlaps=(r:readonly number[],s:readonly number[])=>r[0]<s[2]+2&&r[2]>s[0]-2&&r[1]<s[3]+2&&r[3]>s[1]-2;
  const normalize=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'');let text='';
  if(location.source==='ocr'){
    const {bytes}=await library.resources.read(entryId,location.ocrId!);const data=JSON.parse(bytes.toString('utf8')) as import('../src/lib/pdf-data').PdfOcrData;
    text=data.lines.filter(l=>location.rects.some(r=>overlaps(r,l.rect))).map(l=>l.text).join(' ');
  }else{
    const {bytes}=await library.resources.read(entryId,location.fileHash);const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(bytes),stopAtErrors:true,useSystemFonts:false});
    try{const pdf=await task.promise,page=await pdf.getPage(location.page),content=await page.getTextContent();text=content.items.flatMap(item=>{if(!('str'in item))return [];const [a,b,c,d,x,y]=item.transform,h=Math.max(Math.abs(item.height),Math.hypot(c,d),1),w=Math.max(Math.abs(item.width),Math.hypot(a,b),1),rect=[x-h,y-h/3,x+w+h,y+h];return location.rects.some(r=>overlaps(r,rect))?[item.str]:[];}).join(' ');}finally{await task.destroy();}
  }
  // Context is source text too: verify the complete supplied window against authorized text.
  // Existing native/OCR selection drafts use empty prefix/suffix; those stay valid.
  return normalize(text).includes(normalize(anchor.prefix+anchor.quote+anchor.suffix));
}

/** Mirrors bookmark-only DOM roots, including safe div/span text outside AI blocks. */
export function bookmarkSourceRoots(workspace:Workspace,translated=false):Map<string,string>{
 if(workspace.document.kind==='pdf')return new Map();
 const web=workspace.document.kind==='web'?buildTranslationSource(workspace.document.markdown,workspace.document.web):undefined;
 const tree=parseFragment(web?(translated?renderTranslatedHtml(web,workspace.webTranslation?.units??{}):web.html):marked.parse(workspace.document.markdown,{async:false,gfm:true,breaks:false}) as string);
 const ids=new Map<Node,string>();let ordinal=0;
 walk(tree,node=>{if(!tags.has(node.nodeName))return;const raw=text(node),clean=raw.replace(/\s+/g,' ').trim();ids.set(node,web&&'attrs'in node?node.attrs.find(a=>a.name==='data-block-id')?.value??'':`block-${ordinal++}-${stableHash(`${node.nodeName}:${clean}`).slice(0,7)}`);});
 const visible=(node:Node,code=false):string=>{if(excludedTextNodes.has(node.nodeName))return '';if(node.nodeName==='#text')return code?text(node):text(node).replace(/==([^=\n]+)==/g,'$1');return 'childNodes'in node?node.childNodes.map(child=>visible(child,code||node.nodeName==='pre'||node.nodeName==='code')).join(''):'';};
 const uncovered=(node:Node):boolean=>{if(ids.has(node)||excludedTextNodes.has(node.nodeName))return false;if(node.nodeName==='#text')return !!visible(node).trim();return 'childNodes'in node&&node.childNodes.some(uncovered);};
 const result=new Map<string,string>();let rootIndex=0;
 const visit=(node:Node)=>{if(excludedTextNodes.has(node.nodeName))return;const element='tagName'in node;if(element&&(ids.has(node)||uncovered(node))){const value=visible(node),clean=value.replace(/\s+/g,' ').trim();const id=ids.get(node)||`bookmark-${rootIndex}-${stableHash(`${node.nodeName}:${clean}`).slice(0,7)}`;result.set(id,value);rootIndex++;return;}if('childNodes'in node)node.childNodes.forEach(visit);};visit(tree);return result;
}

type WebProfile={text:string;legacy?:WebAnchorProjection};
const projectionCache=new WeakMap<Workspace,{document:Workspace['document'];translation:Workspace['webTranslation'];original:Map<string,WebProfile>;translated:Map<string,WebProfile>}>();
function webProfiles(workspace:Workspace){
 const cached=projectionCache.get(workspace);if(cached&&cached.document===workspace.document&&cached.translation===workspace.webTranslation)return cached;
 if(workspace.document.kind!=='web')throw new Error('not web');const source=buildTranslationSource(workspace.document.markdown,workspace.document.web);
 const collect=(html:string)=>{const result=new Map<string,WebProfile>();walk(parseFragment(html),node=>{if('attrs'in node){const id=node.attrs.find(a=>a.name==='data-block-id')?.value;if(id){const current=text(node);result.set(id,{text:current,legacy:parseWebAnchorProjection(node.attrs.find(a=>a.name==='data-web-anchor-legacy')?.value,current)});}}});return result;};
 const result={document:workspace.document,translation:workspace.webTranslation,original:collect(source.html),translated:collect(renderTranslatedHtml(source,workspace.webTranslation?.units??{}))};projectionCache.set(workspace,result);return result;
}
/** Exact read-only projection. Never rewrite stored quote or search for a similar occurrence. */
export function projectBookmarkSourceAnchor(workspace:Workspace,anchor:BookmarkAnchor):BookmarkAnchor|null{
 if(workspace.document.kind!=='web'||anchor.pdf)return anchor;
 if(anchor.segments){const segments=anchor.segments.map(a=>projectBookmarkSourceAnchor(workspace,a));return segments.every((a):a is BookmarkAnchor=>a!==null)?combineBookmarkAnchors(segments):null;}
 const profiles=webProfiles(workspace),profile=(translated:boolean)=>(translated?profiles.translated:profiles.original).get(anchor.blockId);
 const original=profile(false);if(!original)return anchor;const projected=projectWebAnchor(original.text,anchor,original.legacy);if(!projected)return null;
 if(!anchor.translation)return projected;const translated=profile(true);if(!translated)return null;const selection=projectWebAnchor(translated.text,anchor.translation,translated.legacy);return selection?{...projected,translation:selection}:null;
}
