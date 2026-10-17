import {annotateBookmarkBlocks} from './bookmark-dom';
import DOMPurify from 'dompurify';
import type { Anchor, RenderedMarkdown, SelectionDraft, Workspace } from '../types';
import { createAnchor, getAnchorContext } from './anchors';
import { renderTranslatedHtml, TRANSLATION_CONTRACT_VERSION } from './web-translation';
import { applyLocalDocumentImages, renderMarkdown } from './markdown';
import { documentTranslationSource } from './document-translation';
export const selectedQuote=(anchor:Anchor):string=>anchor.segments?anchor.segments.map(selectedQuote).join('\n'):anchor.translation?.quote??anchor.quote;
export function translatedRendering(workspace:Workspace,imageSources?:Record<string,string>):RenderedMarkdown {
  const doc=workspace.document;
  if(doc.kind==='pdf')return {html:'',outline:[]};
  const web=doc.kind==='web'?doc.web:undefined;
  const original=renderMarkdown(doc.markdown,web,web?undefined:imageSources);
  const state=workspace.webTranslation;
  if(workspace.readingSide!=='translated'||!state)return original;
  const {source}=documentTranslationSource(doc)!;
  // Web images come from stored media (no src); local Markdown keeps the original image rules.
  const html=DOMPurify.sanitize(renderTranslatedHtml(source,state.units),{USE_PROFILES:{html:true},ADD_ATTR:['target','rel'],...(web?{FORBID_ATTR:['src','srcset','style'],FORBID_TAGS:['video','audio','iframe','object','embed','source','svg','style','link']}:{})});
  const root=document.createElement('div');root.innerHTML=html;
  if(!web)applyLocalDocumentImages(root,imageSources);
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a=>{if(/^https?:\/\//i.test(a.getAttribute('href')??'')){a.target='_blank';a.rel='noreferrer noopener';}});
  const outline=original.outline.map(item=>({...item,text:root.querySelector<HTMLElement>(`[id="${item.id}"]`)?.textContent?.trim()??item.text}));
  annotateBookmarkBlocks(root);
  return {html:root.innerHTML,outline};
}
export function canonicalTranslationDraft(draft:SelectionDraft,workspace:Workspace):SelectionDraft|null {
  const translationSource=workspace.readingSide==='translated'&&workspace.webTranslation?documentTranslationSource(workspace.document):null;
  if(!translationSource||!workspace.webTranslation)return draft;
  const {source,sourceVersion}=translationSource;
  const block=source.blocks.find(b=>b.id===draft.anchor.blockId);
  if(!block)return null;
  const original=createAnchor({documentId:workspace.document.id,blockId:block.id,headingPath:block.headingPath,blockText:block.text,start:0,end:block.text.length});
  if(!original)return null;
  const translated=draft.anchor;
  return {...draft,anchor:{...original,translation:{version:TRANSLATION_CONTRACT_VERSION,translationId:workspace.webTranslation.id,sourceVersion,blockId:block.id,quote:translated.quote,prefix:translated.prefix,suffix:translated.suffix,start:translated.start,end:translated.end}},context:`译文选区：${getAnchorContext(translated).slice(0,1600)}\n对应原文段落（非逐词对齐）：${block.text.slice(0,2000)}`};
}
export function translationContext(anchor:Anchor):string|undefined {
  if(anchor.segments)return anchor.segments.some(segment=>segment.translation)?`选区为已保存的译文；对应原文段落（非逐词对齐）：\n${anchor.segments.map(segment=>segment.quote).join('\n')}`:undefined;
  return anchor.translation ? `译文选区：${getAnchorContext(anchor.translation).slice(0,1600)}\n对应原文段落（非逐词对齐）：${anchor.quote.slice(0,2000)}` : undefined;
}
