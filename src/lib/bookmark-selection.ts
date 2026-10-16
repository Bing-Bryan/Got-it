import {projectDomWebAnchor} from './web-anchor-compat';
import {bookmarkRootElements,bookmarkElementId,findBookmarkElement} from './bookmark-dom';
import type { Anchor, SelectionDraft, Workspace } from '../types';
import { createAnchor,createAnchorFromSelection } from './anchors';
import { canonicalTranslationDraft } from './translation-reading';
import { bookmarkSegments, combineBookmarkAnchors, type BookmarkAnchor } from './bookmark-types';
export interface BookmarkDraft extends Omit<SelectionDraft,'anchor'> {anchor:BookmarkAnchor}
export function bookmarkBlocks(article:HTMLElement){return bookmarkRootElements(article);}
export function createBookmarkDraft(selection:Selection|null,article:HTMLElement,workspace:Workspace):BookmarkDraft|{error:string}{
 if(!selection||selection.isCollapsed||selection.rangeCount!==1)return {error:'请先选择要收藏的文字。'};
 const range=selection.getRangeAt(0);if(!article.contains(range.startContainer)||!article.contains(range.endContainer))return {error:'选区不在当前材料中。'};
 // Preserve the exact historical single-block identity before using supplemental roots.
 const original=createAnchorFromSelection(selection,article,workspace.document.id);
 if(!('error'in original)&&[...article.querySelectorAll<HTMLElement>('[data-block-id]')].some(block=>block.dataset.blockId===original.anchor.blockId)){const canonical=canonicalTranslationDraft(original,workspace);if(canonical)return canonical;return {error:'译文无法对应已保存的原文段落，请切回原文收藏。'};}

 const rect=range.getBoundingClientRect?.(),segments:Anchor[]=[];
 for(const block of bookmarkBlocks(article)){
  if(!range.intersectsNode(block))continue;
  const full=document.createRange();full.selectNodeContents(block);
  const selected=range.cloneRange();if(selected.compareBoundaryPoints(Range.START_TO_START,full)<0)selected.setStart(block,0);if(selected.compareBoundaryPoints(Range.END_TO_END,full)>0)selected.setEnd(block,block.childNodes.length);
  if(selected.collapsed||!selected.toString().trim())continue;
  const before=document.createRange();before.selectNodeContents(block);before.setEnd(selected.startContainer,selected.startOffset);const start=before.toString().length,end=start+selected.toString().length;
  let headingPath:string[]=[];try{headingPath=JSON.parse(block.dataset.headingPath??'[]');}catch{/* Optional heading metadata. */}
  const anchor=createAnchor({documentId:workspace.document.id,blockId:bookmarkElementId(block),blockText:block.textContent??'',start,end,headingPath,contextLength:240});if(!anchor)return {error:'无法读取完整收藏范围，请重新选择。'};
  const draft=canonicalTranslationDraft({anchor,rect:{top:0,left:0,width:0,height:0},context:''},workspace);if(!draft)return {error:'译文范围无法对应已保存的原文段落，请切回原文选择。'};segments.push(draft.anchor);
 }
 if(!segments.length)return {error:'选区中没有支持的文字。'};
 // Whitespace between blocks becomes one newline; no other selected text may disappear.
 if(range.toString().replace(/\s+/g,'')!==segments.map(segment=>segment.translation?.quote??segment.quote).join('').replace(/\s+/g,''))return {error:'这段选区包含暂不支持的文字结构，无法完整收藏。请缩小范围后重试。'};
 const anchor=combineBookmarkAnchors(segments);return {anchor,rect:{top:rect?.top??0,left:rect?.left??0,width:rect?.width??0,height:rect?.height??0},context:''};
}
export function bookmarkDomRanges(article:HTMLElement,anchor:BookmarkAnchor):Range[]|null{
 const ranges:Range[]=[];
 for(const segment of bookmarkSegments(anchor)){
  const translated=article.dataset.readingSide==='translated';
  if(translated&&(!segment.translation||segment.translation.translationId!==article.dataset.translationId||String(segment.translation.version)!==article.dataset.translationVersion))return null;
  const stored=translated?segment.translation!:segment;
  const block=findBookmarkElement(article,segment.blockId);if(!block)return null;const projected=projectDomWebAnchor(block,stored);if(!projected)return null;
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node:Node|null,offset=0,start:{node:Node;offset:number}|undefined,end:typeof start;
  while(node=walker.nextNode()){const length=node.textContent?.length??0;if(!start&&projected.start<=offset+length)start={node,offset:projected.start-offset};if(projected.end<=offset+length){end={node,offset:projected.end-offset};break;}offset+=length;}
  if(!start||!end)return null;const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);ranges.push(range);
 }
 return ranges;
}
