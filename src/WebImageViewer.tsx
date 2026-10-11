import { useEffect, useRef, useState, type RefObject } from "react";
/** Only already authenticated blob images can open; the reader never follows source URLs. */
export function WebImageViewer({ article, documentKey }: { article: RefObject<HTMLElement | null>; documentKey: string }) {
  const [image,setImage]=useState<{src:string;alt:string;width:number;height:number;origin:HTMLImageElement}|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const root=article.current;if(!root)return;
    const open=(target:EventTarget|null)=>{if(!(target instanceof HTMLImageElement)||!target.matches('img[data-web-media]')||!target.src.startsWith('blob:')||!target.naturalWidth)return;setImage({src:target.src,alt:target.alt,width:target.naturalWidth,height:target.naturalHeight,origin:target});};
    const click=(event:Event)=>open(event.target);
    const key=(event:KeyboardEvent)=>{if((event.key==='Enter'||event.key===' ')&&event.target instanceof HTMLImageElement){event.preventDefault();open(event.target);}};
    root.addEventListener('click',click);root.addEventListener('keydown',key);
    return()=>{root.removeEventListener('click',click);root.removeEventListener('keydown',key);};
  },[article,documentKey]);
  useEffect(()=>{setImage(null);},[documentKey]);
  useEffect(()=>{
    if(!image||!dialog.current)return;const el=dialog.current;
    if(el.showModal)el.showModal();else el.open=true;
    return()=>{if(el.close)el.close();else el.open=false;image.origin.focus({preventScroll:true});};
  },[image]);
  if(!image)return null;
  return <dialog ref={dialog} className="web-image-dialog" aria-label="静态图片原尺寸查看" onKeyDown={event=>{if(event.key === "Escape")event.stopPropagation();}} onCancel={event=>{event.preventDefault();setImage(null);}}>
    <header><span title={image.alt}>静态图片／图表</span><button autoFocus type="button" onClick={()=>setImage(null)}>关闭图片</button></header>
    <p>原尺寸查看，可横向和纵向滚动。关闭后回到原阅读位置。</p>
    <div className="web-image-viewport" tabIndex={0} aria-label="可滚动的原尺寸图片"><img src={image.src} alt={image.alt} width={image.width} height={image.height}/></div>
  </dialog>;
}
