/** Bookmark jumps always center actual text; ordinary inquiry/outline scrolling stays separate. */
export interface BookmarkRect {top:number;bottom:number;left:number;right:number}
export function bookmarkViewport(scroll:HTMLElement){
 const bounds=scroll.getBoundingClientRect(),tools=scroll.querySelector<HTMLElement>('.pdf-toolbar')?.getBoundingClientRect();
 const top=Math.max(0,bounds.top+scroll.clientTop,tools&&tools.bottom>bounds.top&&tools.top<bounds.bottom?tools.bottom:bounds.top);
 const bottom=Math.min(bounds.bottom,window.innerHeight||bounds.bottom);
 return{top,bottom,left:bounds.left,right:bounds.right};
}
export function revealBookmarkRects(scroll:HTMLElement,rects:readonly BookmarkRect[]):boolean{
 const visible=bookmarkViewport(scroll),valid=rects.filter(r=>Number.isFinite(r.top)&&Number.isFinite(r.bottom)&&r.bottom>r.top&&r.right>r.left);
 if(!valid.length||visible.bottom<=visible.top)return false;
 const first=valid[0],top=Math.min(...valid.map(r=>r.top)),bottom=Math.max(...valid.map(r=>r.bottom));
 const targetCenter=bottom-top<=visible.bottom-visible.top?(top+bottom)/2:(first.top+first.bottom)/2;
 const desired=scroll.scrollTop+targetCenter-(visible.top+visible.bottom)/2;
 const horizontal=first.left<visible.left+8?first.left-visible.left-8:first.right>visible.right-8?Math.min(first.left-visible.left-8,first.right-visible.right+8):0;
 const next={top:Math.max(0,Math.min(Math.max(0,scroll.scrollHeight-scroll.clientHeight),desired)),left:Math.max(0,Math.min(Math.max(0,scroll.scrollWidth-scroll.clientWidth),scroll.scrollLeft+horizontal)),behavior:'instant' as const};
 if(typeof scroll.scrollTo==='function')scroll.scrollTo(next);else {scroll.scrollTop=next.top;scroll.scrollLeft=next.left;}
 return true;
}
export function revealBookmarkRanges(ranges:readonly Range[]):boolean{
 const first=ranges[0],node=first?.startContainer,nodeElement=node instanceof HTMLElement?node:node?.parentElement,scroll=nodeElement?.closest<HTMLElement>('.reader-scroll,.recovery-original');
 if(!scroll)return false;return revealBookmarkRects(scroll,ranges.flatMap(range=>[...range.getClientRects()]));
}
