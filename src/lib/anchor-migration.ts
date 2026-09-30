import { marked } from "marked";
import DOMPurify from "dompurify";
import { stableHash } from "../sample";
import type { Workspace } from "../types";

/** Normalize old offsets once, using the original document, never rewriting old answers. */
export function migrateHighlightAnchors(workspace: Workspace): Workspace {
  if (workspace.document.kind === "pdf") return workspace;
  if (!workspace.inquiries.some(i => i.anchor.textVersion !== 2)) return workspace;
  const root = document.createElement("div");
  root.innerHTML = DOMPurify.sanitize(marked.parse(workspace.document.markdown, { async:false, gfm:true }) as string);
  const blocks = new Map<string, { text:string; removed:Set<number> }>();
  root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,pre,td,th").forEach((block,index) => {
    const text=block.textContent ?? "", clean=text.replace(/\s+/g," ").trim();
    const id=`block-${index}-${stableHash(`${block.tagName.toLowerCase()}:${clean}`).slice(0,7)}`;
    const removed=new Set<number>();let offset=0;
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) { const node=walker.currentNode as Text;
      if(!node.parentElement?.closest("code,pre")) for(const m of node.data.matchAll(/==([^=\n]+)==/g)) {
        const start=offset+m.index!; for(const n of [start,start+1,start+m[0].length-2,start+m[0].length-1]) removed.add(n);
      }
      offset+=node.length;
    }
    blocks.set(id,{text,removed});
  });
  return {...workspace,inquiries:workspace.inquiries.map(i=>{
    const a=i.anchor;if(a.textVersion===2)return i;
    const block=blocks.get(a.blockId);
    if(!block || block.text.slice(a.start,a.end)!==a.quote) return i;
    const strip=(start:number,end:number)=>block.text.slice(start,end).split("").filter((_,n)=>!block.removed.has(start+n)).join("");
    const start=strip(0,a.start).length,quote=strip(a.start,a.end),all=strip(0,block.text.length),end=start+quote.length;
    if(!quote)return i;
    return {...i,anchor:{...a,textVersion:2,start,end,quote,prefix:all.slice(Math.max(0,start-48),start),suffix:all.slice(end,end+48)}};
  })};
}
