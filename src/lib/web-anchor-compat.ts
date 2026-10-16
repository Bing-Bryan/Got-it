/** Read-only compatibility for old anchors whose block text included image status. */
export interface WebAnchorProjection {text:string;removed:Array<[number,number]>}
interface Adapter<N>{children:(node:N)=>N[];text:(node:N)=>string|null;legacy:(node:N)=>string|undefined}
export function collectWebAnchorText<N>(root:N,adapter:Adapter<N>):{text:string;legacy?:WebAnchorProjection}{
 let text='',legacy='',removed:Array<[number,number]>=[];
 const walk=(node:N)=>{const old=adapter.legacy(node);if(old!==undefined){const start=legacy.length;legacy+=old;if(old.length)removed.push([start,legacy.length]);return;}const value=adapter.text(node);if(value!==null){text+=value;legacy+=value;return;}for(const child of adapter.children(node))walk(child);};walk(root);
 return{text,...(removed.length?{legacy:{text:legacy,removed}}:{})};
}
export function domWebAnchorText(root:Node){return collectWebAnchorText(root,{children:n=>[...n.childNodes],text:n=>n.nodeType===3?n.textContent??'':null,legacy:n=>n instanceof Element?n.getAttribute('data-web-legacy-text')??undefined:undefined});}
export function parseWebAnchorProjection(raw:string|undefined,canonical:string):WebAnchorProjection|undefined{
 if(!raw||raw.length>2_000_000)return;try{const v=JSON.parse(raw);if(!v||typeof v.text!=='string'||v.text.length>1_000_000||!Array.isArray(v.removed)||!v.removed.length||v.removed.length>100)return;let end=0,result='';for(const pair of v.removed){if(!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isSafeInteger)||pair[0]<end||pair[1]<=pair[0]||pair[1]>v.text.length)return;result+=v.text.slice(end,pair[0]);end=pair[1];}result+=v.text.slice(end);if(result!==canonical)return;return v as WebAnchorProjection;}catch{return;}
}
export function projectWebAnchor<T extends {start:number;end:number;quote:string;prefix?:string;suffix?:string}>(canonical:string,anchor:T,projection?:WebAnchorProjection):T|null{
 const exact=(text:string)=>Number.isSafeInteger(anchor.start)&&Number.isSafeInteger(anchor.end)&&anchor.start>=0&&anchor.end>anchor.start&&text.slice(anchor.start,anchor.end)===anchor.quote&&(anchor.prefix===undefined||text.slice(Math.max(0,anchor.start-anchor.prefix.length),anchor.start)===anchor.prefix)&&(anchor.suffix===undefined||text.slice(anchor.end,anchor.end+anchor.suffix.length)===anchor.suffix);
 if(exact(canonical))return anchor;if(!projection||!exact(projection.text)||projection.removed.some(([start,end])=>anchor.start<end&&anchor.end>start))return null;
 const offset=(at:number)=>at-projection.removed.reduce((sum,[start,end])=>sum+Math.max(0,Math.min(at,end)-start),0),start=offset(anchor.start),end=offset(anchor.end);
 if(canonical.slice(start,end)!==anchor.quote)return null;return{...anchor,start,end,...(anchor.prefix===undefined?{}:{prefix:canonical.slice(Math.max(0,start-anchor.prefix.length),start)}),...(anchor.suffix===undefined?{}:{suffix:canonical.slice(end,end+anchor.suffix.length)})};
}
export function projectDomWebAnchor<T extends {start:number;end:number;quote:string;prefix?:string;suffix?:string}>(block:HTMLElement,anchor:T):T|null{return projectWebAnchor(block.textContent??'',anchor,parseWebAnchorProjection(block.dataset.webAnchorLegacy,block.textContent??''));}
