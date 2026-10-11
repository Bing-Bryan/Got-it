import DOMPurify from 'dompurify';
import type { Anchor, RenderedMarkdown, SelectionDraft, Workspace } from '../types';
import { createAnchor, getAnchorContext } from './anchors';
import { buildTranslationSource, renderTranslatedHtml, TRANSLATION_CONTRACT_VERSION } from './web-translation';
import { renderMarkdown } from './markdown';
export const selectedQuote=(anchor:Anchor)=>anchor.translation?.quote ?? anchor.quote;
export function translatedRendering(workspace:Workspace):RenderedMarkdown {
  if(workspace.document.kind!=='web')return {html:'',outline:[]};
  const original=renderMarkdown(workspace.document.markdown,workspace.document.web);
  const state=workspace.webTranslation;
  if(workspace.readingSide!=='translated'||!state)return original;
  const source=buildTranslationSource(workspace.document.markdown,workspace.document.web);
  const html=DOMPurify.sanitize(renderTranslatedHtml(source,state.units),{USE_PROFILES:{html:true},ADD_ATTR:['target','rel'],FORBID_ATTR:['src','srcset','style'],FORBID_TAGS:['video','audio','iframe','object','embed','source','svg','style','link']});
  const root=document.createElement('div');root.innerHTML=html;
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a=>{if(/^https?:\/\//i.test(a.getAttribute('href')??'')){a.target='_blank';a.rel='noreferrer noopener';}});
  const outline=original.outline.map(item=>({...item,text:root.querySelector<HTMLElement>(`[id="${item.id}"]`)?.textContent?.trim()??item.text}));
  return {html:root.innerHTML,outline};
}
export function canonicalTranslationDraft(draft:SelectionDraft,workspace:Workspace):SelectionDraft|null {
  if(workspace.document.kind!=='web'||workspace.readingSide!=='translated'||!workspace.webTranslation)return draft;
  const source=buildTranslationSource(workspace.document.markdown,workspace.document.web);
  const block=source.blocks.find(b=>b.id===draft.anchor.blockId);
  if(!block)return null;
  const original=createAnchor({documentId:workspace.document.id,blockId:block.id,headingPath:block.headingPath,blockText:block.text,start:0,end:block.text.length});
  if(!original)return null;
  const translated=draft.anchor;
  return {...draft,anchor:{...original,translation:{version:TRANSLATION_CONTRACT_VERSION,translationId:workspace.webTranslation.id,sourceVersion:workspace.document.web.contentVersion,blockId:block.id,quote:translated.quote,prefix:translated.prefix,suffix:translated.suffix,start:translated.start,end:translated.end}},context:`译文选区：${getAnchorContext(translated).slice(0,1600)}\n对应原文段落（非逐词对齐）：${block.text.slice(0,2000)}`};
}
export function translationContext(anchor:Anchor):string|undefined {
  return anchor.translation ? `译文选区：${getAnchorContext(anchor.translation).slice(0,1600)}\n对应原文段落（非逐词对齐）：${anchor.quote.slice(0,2000)}` : undefined;
}
