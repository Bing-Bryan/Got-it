import {domWebAnchorText} from './web-anchor-compat';
import {stableHash} from '../sample';
const selector='[data-block-id],[data-bookmark-block-id]';
/** Adds bookmark-only identities to safe text containers omitted by inquiry blocks. */
export function annotateBookmarkBlocks(root:HTMLElement){
 const existing=[...root.querySelectorAll<HTMLElement>('[data-block-id]')];
 const extras=[...root.querySelectorAll<HTMLElement>('*')].filter(element=>{
  if(element.closest('[data-block-id]'))return false;
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null;
  while(node=walker.nextNode())if(node.textContent?.trim()&&!node.parentElement?.closest('[data-block-id]'))return true;
  return false;
 });
 const candidates=new Set([...existing,...extras]);
 const roots=[...root.querySelectorAll<HTMLElement>('*')].filter(element=>{if(!candidates.has(element))return false;let parent=element.parentElement;while(parent&&parent!==root){if(candidates.has(parent))return false;parent=parent.parentElement;}return true;});
 roots.forEach((element,index)=>{if(element.dataset.blockId)return;const projected=domWebAnchorText(element);const clean=(projected.legacy?.text??element.textContent??'').replace(/\s+/g,' ').trim();if(projected.legacy)element.dataset.webAnchorLegacy=JSON.stringify(projected.legacy);element.dataset.bookmarkBlockId=`bookmark-${index}-${stableHash(`${element.tagName.toLowerCase()}:${clean}`).slice(0,7)}`;});
}
export function bookmarkRootElements(root:HTMLElement){return [...root.querySelectorAll<HTMLElement>(selector)].filter(element=>!element.parentElement?.closest(selector));}
export function bookmarkElementId(element:HTMLElement){return element.dataset.bookmarkBlockId??element.dataset.blockId!;}
export function findBookmarkElement(root:HTMLElement,id:string){return [...root.querySelectorAll<HTMLElement>(selector)].find(element=>bookmarkElementId(element)===id);}
