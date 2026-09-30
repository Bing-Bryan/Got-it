import {normalized,screenRect,originalRect} from "./lib/pdf-geometry";
import {abortable} from "./lib/abortable";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker, PSM } from 'tesseract.js';
import { libraryBinary, libraryRequest } from './lib/library-client';
import { MAX_CROP_BYTES, copyOcr, type PdfLocation, type PdfOcrData, type PdfRect } from './lib/pdf-data';
import type { ActiveInquiryIntent, Anchor, DocumentSnapshot, Inquiry, SelectionDraft } from './types';
import type { ReadingPosition } from './lib/library-types';
import './pdf-reader.css';
GlobalWorkerOptions.workerSrc = workerUrl;
type PdfDocument = Extract<DocumentSnapshot, {kind:'pdf'}>;
type Viewport = ReturnType<PDFPageProxy['getViewport']>;
interface Props { document:PdfDocument; entryId:string; inquiries:Inquiry[]; activeId?:string|null; target?:{id:string;nonce:number}|null; initialPosition?:ReadingPosition; readOnly?:boolean; saveStatus?:string; saveBusy?:boolean; saveError?:boolean; onCreate?:(intent:ActiveInquiryIntent,draft:SelectionDraft)=>void; onActivate?:(id:string)=>void; onReady?:()=>void; onView?:()=>void }
interface SheetToolbar {page:number;ready:boolean;mode:'text'|'region';busy:boolean;start:()=>void;cancel:()=>void}
const rectStyle=(r:PdfRect)=>({left:r[0],top:r[1],width:r[2]-r[0],height:r[3]-r[1]});
const errorText=(e:unknown)=>e instanceof Error?e.message:'PDF 操作未完成，请重试。';
const tidy=(s:string)=>s.trim().replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'');
export default function PdfReader(props:Props) {
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[error,setError]=useState('');
  const [width,setWidth]=useState(700),[draftPage,setDraftPage]=useState<number|null>(null);
  const [currentPage,setCurrentPage]=useState(props.initialPosition?.pdfPage??1),[toolbar,setToolbar]=useState<SheetToolbar|null>(null);
  const root=useRef<HTMLDivElement>(null),restored=useRef(false);
  useEffect(()=>{if(!pdf||restored.current)return;const frame=requestAnimationFrame(()=>{restored.current=true;props.onReady?.();});return()=>cancelAnimationFrame(frame);},[pdf,width]);
  useEffect(()=>{
    const scroll=root.current?.closest<HTMLElement>('.reader-scroll,.recovery-original');if(!scroll||!pdf)return;
    const update=()=>{const bounds=scroll.getBoundingClientRect(),top=bounds.top+36;let visible=0,page=0;for(const sheet of root.current!.querySelectorAll<HTMLElement>('[data-pdf-page]')){const r=sheet.getBoundingClientRect(),height=Math.max(0,Math.min(r.bottom,bounds.bottom)-Math.max(r.top,top));if(height>visible){visible=height;page=Number(sheet.dataset.pdfPage);}}if(page)setCurrentPage(page);};
    update();scroll.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);
    return()=>{scroll.removeEventListener('scroll',update);window.removeEventListener('resize',update);};
  },[pdf,width]);
  const resizeAnchor=useRef<{node:HTMLElement;fraction:number}|null>(null);
  useLayoutEffect(()=>{const a=resizeAnchor.current,scroll=root.current?.closest<HTMLElement>('.reader-scroll');if(!a||!scroll)return;resizeAnchor.current=null;const top=scroll.scrollTop+a.node.getBoundingClientRect().top-scroll.getBoundingClientRect().top+a.fraction*a.node.clientHeight;if(typeof scroll.scrollTo==='function')scroll.scrollTo({top,behavior:'instant'});else scroll.scrollTop=top;},[width]);
  useEffect(()=>{const el=root.current;if(!el)return;const resize=()=>{const next=Math.max(120,el.clientWidth-40);const scroll=el.closest<HTMLElement>('.reader-scroll');if(scroll&&restored.current){const top=scroll.getBoundingClientRect().top;const node=[...el.querySelectorAll<HTMLElement>('.pdf-page')].find(p=>p.getBoundingClientRect().bottom>top+55);if(node)resizeAnchor.current={node,fraction:(top-node.getBoundingClientRect().top)/Math.max(1,node.clientHeight)};}setWidth(next);};const observer=new ResizeObserver(resize);observer.observe(el);resize();return()=>observer.disconnect();},[]);
  useEffect(()=>{
    let disposed=false;let task:ReturnType<typeof getDocument>|undefined;
    void(async()=>{try{const response=await libraryBinary(`/entries/${props.entryId}/resources/${props.document.pdf.resourceId}`);if(disposed)return;task=getDocument({data:new Uint8Array(await response.arrayBuffer()),cMapUrl:'/pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-assets/standard_fonts/',wasmUrl:'/pdf-assets/wasm/',enableXfa:false});const doc=await task.promise;if(!disposed)setPdf(doc);}catch(e){if(!disposed)setError(errorText(e));}})();
    return()=>{disposed=true;void task?.destroy();};
  },[props.entryId,props.document.pdf.resourceId]);
  const activeToolbar=toolbar?.page===currentPage?toolbar:null;
  const saved=props.saveStatus==='已保存到本机';
  const saveLabel=props.saveError?'未保存':props.saveBusy?'处理中':saved?'✓ 已保存':props.saveStatus==='保存中…'?'保存中…':props.saveStatus??'';
  return <div ref={root} className="pdf-reader" data-zoom="0">
    <div className="pdf-toolbar" aria-label="PDF 阅读工具栏">
      <span className="pdf-page-number" aria-live="off">第 {currentPage} / {props.document.pdf.pages.length} 页</span>
      {!props.readOnly?<><button type="button" className="pdf-select-mode" aria-pressed={activeToolbar?.mode==='region'} disabled={!activeToolbar?.ready} onClick={()=>{if(activeToolbar?.busy||activeToolbar?.mode==='region')activeToolbar.cancel();else activeToolbar?.start();}}>{activeToolbar?.busy?'取消识别':activeToolbar?.mode==='region'?'取消框选':'框选内容'}</button>{activeToolbar?.mode==='region'||activeToolbar?.busy?<span className="pdf-mode-hint">{activeToolbar.busy?'识别中…':'拖动框选'}</span>:null}</>:<span className="pdf-mode-hint">只读</span>}
      <span className="pdf-inline-help" title="文字可直接拖选；图片或不可选文字可先框选，再选择功能。按 Esc、取消或点击空白处清除选区。">文字可直接拖选；图片或不可选文字可先框选，再选择功能。按 Esc、取消或点击空白处清除选区。</span>
      <span className={`pdf-save-state ${props.saveError?'failed':''}`} role="status" title={props.saveStatus}>{saveLabel}</span>
    </div>
    {error?<p className="pdf-error" role="alert">{error}</p>:null}
    {!pdf&&!error?<p className="pdf-status">正在加载 PDF…</p>:null}
    {pdf?props.document.pdf.pages.map((info,index)=><PdfSheet key={index} {...props} pdf={pdf} page={index+1} width={width} info={info} draftPage={draftPage} currentPage={currentPage} onToolbar={setToolbar} claim={()=>setDraftPage(index+1)}/>):null}
  </div>;
}
interface SheetProps extends Props {pdf:PDFDocumentProxy;page:number;width:number;info:PdfDocument['pdf']['pages'][number];draftPage:number|null;currentPage:number;onToolbar:(state:SheetToolbar)=>void;claim:()=>void}
function PdfSheet(props:SheetProps) {
  const {pdf,page,width,info}=props;
  const latest=useRef(props);latest.current=props;
  const appliedTarget=useRef('');
  const [near,setNear]=useState(page===(props.initialPosition?.pdfPage??1));
  const [viewport,setViewport]=useState<Viewport|null>(null),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [mode,setMode]=useState<'text'|'region'>('text'),[box,setBox]=useState<PdfRect|null>(null);
  const [preview,setPreview]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
  const [ocr,setOcr]=useState<Array<{id:string;data:PdfOcrData}>>([]),[selection,setSelection]=useState<{anchor:Anchor;preview:string}|null>(null),[quote,setQuote]=useState('');
  const card=useRef<HTMLDivElement>(null);
  const root=useRef<HTMLDivElement>(null),surface=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),native=useRef<HTMLDivElement>(null),ocrLayer=useRef<HTMLDivElement>(null);
  const ocrCache=useRef(new Map<string,{id:string;data:PdfOcrData}>());
  const drag=useRef<[number,number]|null>(null),operation=useRef<AbortController|null>(null),pageProxy=useRef<PDFPageProxy|null>(null);
  const cancel=()=>{drag.current=null;operation.current?.abort();operation.current=null;setBusy(false);setStatus('');setBox(null);setPreview('');setSelection(null);setMode('text');const selected=window.getSelection();if(selected?.anchorNode&&surface.current?.contains(selected.anchorNode))selected.removeAllRanges();};
  useEffect(()=>{if(props.currentPage===page)props.onToolbar({page,ready,mode,busy,start:()=>{props.claim();cancel();setMode('region');},cancel});else cancel();},[props.currentPage,page,ready,mode,busy]);
  useLayoutEffect(()=>{
    const popup=card.current, pageElement=surface.current;
    if(!popup||!pageElement||!viewport)return;
    const rects=box?[box]:selection?.anchor.pdf?.rects;
    if(!rects?.length)return;
    const scroll=pageElement.closest<HTMLElement>('.reader-scroll,.recovery-original');
    const place=()=>{
      const pageBounds=pageElement.getBoundingClientRect(), reader=scroll?.getBoundingClientRect();
      const left=Math.max(12,(reader?.left??0)+12), right=Math.min(innerWidth-12,(reader?.right??innerWidth)-12);
      const top=Math.max(12,(reader?.top??0)+(root.current?.closest('.pdf-reader')?.querySelector('.pdf-toolbar')?.getBoundingClientRect().height??0)+8);
      const bottom=Math.min(innerHeight-12,(reader?.bottom??innerHeight)-12);
      const r=screenRect(viewport,rects[rects.length-1]);
      const anchor={left:pageBounds.left+r[0],right:pageBounds.left+r[2],top:pageBounds.top+r[1],bottom:pageBounds.top+r[3]};
      popup.style.visibility=anchor.bottom<top||anchor.top>bottom?'hidden':'visible';
      popup.style.width=`${Math.max(0,Math.min(360,right-left))}px`;
      popup.style.maxHeight=`${Math.max(0,bottom-top)}px`;
      const size=popup.getBoundingClientRect();
      const below=anchor.bottom+10, above=anchor.top-size.height-10;
      const y=below+size.height<=bottom?below:above>=top?above:Math.max(top,Math.min(bottom-size.height,below));
      popup.style.left=`${Math.max(left,Math.min(right-size.width,anchor.left))}px`;
      popup.style.top=`${y}px`;
    };
    place();
    const observer=new ResizeObserver(place);observer.observe(popup);observer.observe(pageElement);
    window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
    return()=>{observer.disconnect();window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);};
  },[box,selection,preview,viewport]);
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')cancel();};window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);operation.current?.abort();};},[]);
  useEffect(()=>{const el=root.current;if(!el)return;const observer=new IntersectionObserver(entries=>setNear(entries[0].isIntersecting),{root:el.closest('.reader-scroll,.recovery-original'),rootMargin:'600px 0px'});observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(props.draftPage!==page)cancel();},[props.draftPage,page]);
  useEffect(()=>{if(!box&&!selection)return;const outside=(event:PointerEvent)=>{
    if(card.current?.contains(event.target as Node))return;
    if(root.current?.closest('.pdf-reader')?.querySelector('.pdf-toolbar')?.contains(event.target as Node))return;
    const bounds=surface.current?.getBoundingClientRect();
    const rects=box?[box]:selection?.anchor.pdf?.rects??[];
    if(bounds&&viewport&&rects.some(r=>{const sr=screenRect(viewport,r);return event.clientX>=bounds.left+sr[0]&&event.clientX<=bounds.left+sr[2]&&event.clientY>=bounds.top+sr[1]&&event.clientY<=bounds.top+sr[3];}))return;
    cancel();
  };document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[box,selection,viewport]);

  useEffect(()=>{if(!near){cancel();setReady(false);}},[near]);
  useEffect(()=>{cancel();setOcr([]);},[page]);
  useEffect(()=>{
    setError('');setReady(false);let disposed=false;let render:ReturnType<PDFPageProxy['render']>|undefined;let text:TextLayer|undefined;
    if(!near)return;
    void(async()=>{try{
      const p=await pdf.getPage(page);if(disposed)return;pageProxy.current=p;
      const base=p.getViewport({scale:1});const scale=width/base.width;
      const v=p.getViewport({scale});const dpr=Math.min(window.devicePixelRatio||1,2,Math.sqrt(12_000_000/(v.width*v.height)));
      const c=canvas.current!,layer=native.current!;c.width=Math.ceil(v.width*dpr);c.height=Math.ceil(v.height*dpr);c.style.width=v.width+'px';c.style.height=v.height+'px';layer.replaceChildren();
      setViewport(v);render=p.render({canvas:c,viewport:v,transform:[dpr,0,0,dpr,0,0]});await render.promise;if(disposed)return;
      const content=await p.getTextContent();if(disposed)return;
      layer.style.setProperty('--scale-factor',String(scale));layer.style.setProperty('--total-scale-factor',String(scale));text=new TextLayer({textContentSource:content,container:layer,viewport:v});await text.render();if(disposed)return;
      const ids=[...new Set(latest.current.inquiries.filter(i=>i.anchor.pdf?.page===page).map(i=>i.anchor.pdf?.ocrId).filter((id):id is string=>!!id))];
      const cached=await Promise.allSettled(ids.map(async id=>{const r=await libraryBinary(`/entries/${props.entryId}/resources/${id}`);const data=copyOcr(await r.json());if(!data||data.fileHash!==props.document.pdf.resourceId||data.page!==page)throw new Error('识别资源与当前原页不符。');return {id,data};}));
      if(disposed)return;
      for(const result of cached){if(result.status==='fulfilled')ocrCache.current.set(result.value.id,result.value);else setError(`部分识别文字无法恢复，仍可选字或重新框选。${errorText(result.reason)}`);}
      setOcr([...ocrCache.current.values()].filter(o=>o.data.page===page));setReady(true);
    }catch(e){if(!disposed){setError(errorText(e));setReady(false);}}})();
    return()=>{disposed=true;render?.cancel();text?.cancel();};
  },[pdf,page,near,width]);
  useEffect(()=>{
    const t=props.target;if(!t)return;const key=`${t.id}:${t.nonce}`;if(appliedTarget.current===key)return;const a=props.inquiries.find(i=>i.id===t.id)?.anchor.pdf;
    if(!a||a.fileHash!==props.document.pdf.resourceId){setError('此知识贴无法定位到当前文件。');return;}
    if(a.page!==page)return;
    if(!ready){root.current?.scrollIntoView({block:'start'});setNear(true);return;}
    if(ready&&pageProxy.current?.pageNumber===page){appliedTarget.current=key;requestAnimationFrame(()=>root.current?.querySelector(`[data-pdf-inquiry="${CSS.escape(t.id)}"]`)?.scrollIntoView({block:'center',inline:'nearest'}));}
  },[props.target,page,ready,props.document.pdf.resourceId]);
  useEffect(()=>{if(!viewport)return;for(const el of ocrLayer.current?.querySelectorAll<HTMLElement>('[data-line]')??[]){el.style.transform='none';const desired=Number(el.dataset.width),actual=el.getBoundingClientRect().width;if(actual)el.style.transform=`scaleX(${desired/actual})`; }},[ocr,viewport]);
  const point=(event:{clientX:number;clientY:number}):[number,number]=>{const r=surface.current!.getBoundingClientRect();return [Math.max(0,Math.min(r.width,event.clientX-r.left)),Math.max(0,Math.min(r.height,event.clientY-r.top))];};
  function crop(r:PdfRect):HTMLCanvasElement {
    const c=canvas.current!,v=viewport!,s=screenRect(v,r),ratio=c.width/v.width;
    const w=Math.max(1,Math.round((s[2]-s[0])*ratio)),h=Math.max(1,Math.round((s[3]-s[1])*ratio)),shrink=Math.min(1,4096/w,4096/h);
    const out=document.createElement('canvas');out.width=Math.max(1,Math.round(w*shrink));out.height=Math.max(1,Math.round(h*shrink));out.getContext('2d')!.drawImage(c,s[0]*ratio,s[1]*ratio,w,h,0,0,out.width,out.height);return out;
  }
  function previewFor(rect:PdfRect):string {
    let image=crop(rect),encoded=image.toDataURL('image/png');
    // The preview is the upload: reduce noisy/photo crops until both limits hold.
    while((encoded.length-encoded.indexOf(',')-1)*3/4>MAX_CROP_BYTES && image.width>1 && image.height>1){
      const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.floor(image.width*.8));smaller.height=Math.max(1,Math.floor(image.height*.8));
      smaller.getContext('2d')!.drawImage(image,0,0,smaller.width,smaller.height);image=smaller;encoded=image.toDataURL('image/png');
    }
    return encoded;
  }
  function selectedText(){
    if(props.readOnly||busy||mode!=='text'||!viewport)return;
    const selected=window.getSelection();if(!selected||selected.isCollapsed||!selected.rangeCount)return;
    const range=selected.getRangeAt(0);if(!surface.current?.contains(range.commonAncestorContainer)){if(surface.current?.contains(range.startContainer)||surface.current?.contains(range.endContainer))setError('请缩小到同页同一段文字范围。');return;}
    const start=(range.startContainer.parentElement?.closest('[data-ocr-id]'))as HTMLElement|null,end=range.endContainer.parentElement?.closest('[data-ocr-id]')as HTMLElement|null;
    if(start?.dataset.ocrId!==end?.dataset.ocrId){setError('请缩小到同页同一段文字范围。');return;}
    const selectedOcr=start?ocr.find(o=>o.id===start.dataset.ocrId):undefined;
    const text=selected.toString().trim();if(!text||text.length>20000)return;
    const bounds=surface.current.getBoundingClientRect();const rs=Array.from(range.getClientRects()).filter(r=>r.width>1&&r.height>1);
    if(!rs.length)return;
    if(!selectedOcr&&rs.some((r,i)=>rs.slice(i+1).some(s=>Math.abs(r.top-s.top)<Math.min(r.height,s.height)/2&&Math.max(s.left-r.right,r.left-s.right)>Math.max(24,r.height*2)))){setError('选区跨越独立栏区，请缩小范围。');return;}
    const rects=rs.slice(0,500).map(r=>originalRect(viewport,[r.left-bounds.left,r.top-bounds.top,r.right-bounds.left,r.bottom-bounds.top]));
    const a:Anchor={documentId:props.document.id,blockId:`pdf-${page}-${selectedOcr?.id??'native'}`,headingPath:[`第 ${page} 页`],quote:text,prefix:'',suffix:'',start:0,end:text.length,matchStatus:'matched',pdf:{kind:'text',source:selectedOcr?'ocr':'native',fileHash:props.document.pdf.resourceId,page,rects,...(selectedOcr?{ocrId:selectedOcr.id,originalText:text}:{}),context:text}};
    const all=normalized([Math.min(...rects.map(r=>r[0])),Math.min(...rects.map(r=>r[1])),Math.max(...rects.map(r=>r[2])),Math.max(...rects.map(r=>r[3]))]);
    props.claim();setBox(null);setPreview('');setQuote(text);setSelection({anchor:a,preview:previewFor(all)});setError('');
  }
  function create(intent:ActiveInquiryIntent,a:Anchor){latest.current.onCreate?.(intent,{anchor:a,context:a.pdf?.context??a.quote,rect:{top:0,left:0,width:0,height:0}});setSelection(null);setBox(null);setPreview('');setStatus('');}
  async function selectRegion(intent:ActiveInquiryIntent){
    if(!box||!preview||!pageProxy.current||!viewport||busy)return;const rect=box,selectedPreview=preview,controller=new AbortController();operation.current=controller;setBusy(true);setError('');setStatus('正在识别所选内容，随后开始处理…');
    let recognized:{id:string;text:string}|undefined;
    let worker:Awaited<ReturnType<typeof createWorker>>|undefined;const timer=setTimeout(()=>controller.abort(new Error('文字识别超过 60 秒，请缩小范围后重试。')),60000);
    const stop=()=>void worker?.terminate();controller.signal.addEventListener('abort',stop,{once:true});
    try {
      const p=pageProxy.current;const base=p.getViewport({scale:1});const v=p.getViewport({scale:Math.min(2,Math.sqrt(8_000_000/(base.width*base.height)))});
      const full=document.createElement('canvas');full.width=Math.ceil(v.width);full.height=Math.ceil(v.height);const rendering=p.render({canvas:full,viewport:v});const stopRender=()=>rendering.cancel();controller.signal.addEventListener('abort',stopRender,{once:true});await rendering.promise;controller.signal.removeEventListener('abort',stopRender);controller.signal.throwIfAborted();
      worker=await abortable(createWorker('chi_sim+eng',1,{workerPath:'/pdf-assets/worker.min.js',langPath:'/pdf-assets',corePath:'/pdf-assets'}).then(w=>{if(controller.signal.aborted){void w.terminate();throw controller.signal.reason;}return w;}),controller.signal);controller.signal.throwIfAborted();if(!worker)throw new Error('识别器未启动。');await abortable(worker.setParameters({tessedit_pageseg_mode:PSM.AUTO}),controller.signal);
      const sr=screenRect(v,rect);const result=await abortable(worker.recognize(full,{rectangle:{left:Math.floor(sr[0]),top:Math.floor(sr[1]),width:Math.ceil(sr[2]-sr[0]),height:Math.ceil(sr[3]-sr[1])}},{blocks:true,text:true}),controller.signal);controller.signal.throwIfAborted();
      const lines=(result.data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines)).map(l=>({text:tidy(l.text),rect:originalRect(v,[l.bbox.x0,l.bbox.y0,l.bbox.x1,l.bbox.y1]),block:'region'})).filter(l=>l.text);
      // OCR is an aid; the saved image remains the primary material for every intent.
      if(lines.length){
        const saved=await abortable(libraryRequest<{id:string;data:PdfOcrData}>(`/entries/${props.entryId}/ocr`,{version:1,fileHash:props.document.pdf.resourceId,page,lines}),controller.signal);controller.signal.throwIfAborted();
        ocrCache.current.set(saved.id,saved);setOcr(current=>[...current.filter(o=>o.id!==saved.id),saved]);
        recognized={id:saved.id,text:lines.map(l=>l.text).join('\n').slice(0,4000)};
      }
    }catch(e){
      if(controller.signal.aborted){if(operation.current===controller){setError(errorText(controller.signal.reason??new Error('已取消。')));operation.current=null;setBusy(false);}return;}
      // Reading the image still works when local OCR cannot start or recognize text.
      setStatus('辅助文字识别未完成，将依据所选原图处理。');
    }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',stop);await worker?.terminate().catch(()=>{});}
    try {
      controller.signal.throwIfAborted();
      const bytes=await (await fetch(selectedPreview)).blob();controller.signal.throwIfAborted();
      const query=new URLSearchParams({fileHash:props.document.pdf.resourceId,page:String(page),rect:JSON.stringify(rect)});
      const {id}=await(await libraryBinary(`/entries/${props.entryId}/crops?${query}`,bytes)).json();controller.signal.throwIfAborted();
      const location:PdfLocation={kind:'region',source:'image',fileHash:props.document.pdf.resourceId,page,rects:[rect],cropId:id,...(recognized?{ocrId:recognized.id,originalText:recognized.text,context:recognized.text}:{context:'未提取到辅助文字，请依据所选原图处理。'})};
      create(intent,{documentId:props.document.id,blockId:`pdf-${page}-${id}`,headingPath:[`第 ${page} 页`],quote:`第 ${page} 页 · 所选区域`,prefix:'',suffix:'',start:0,end:0,matchStatus:'matched',pdf:location});
    }catch(e){if(operation.current===controller)setError(errorText(e));}
    finally{if(operation.current===controller){operation.current=null;setBusy(false);}}
  }
  const marks=props.inquiries.filter(i=>i.anchor.pdf?.page===page&&i.anchor.pdf.fileHash===props.document.pdf.resourceId);
  const rotated=info.rotation===90||info.rotation===270;
  const ratio=rotated?(info.view[2]-info.view[0])/(info.view[3]-info.view[1]):(info.view[3]-info.view[1])/(info.view[2]-info.view[0]);
  return <section ref={root} className="pdf-sheet" data-pdf-page={page} aria-label={`第 ${page} 页`}>
    {error?<p className="pdf-error" role="alert">第 {page} 页：{error}</p>:null}
    <div className="pdf-page-wrap"><div data-block-id={`pdf-page-${page}`} ref={surface} className={`pdf-page ${mode!=='text'?'drawing':''}`} style={{width,height:width*ratio}}
      onPointerDown={e=>{if(mode==='text'||props.readOnly||!ready||busy)return;e.preventDefault();drag.current=point(e);setBox(null);setPreview('');e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerCancel={()=>{drag.current=null;setBox(null);setPreview('');}}
      onPointerMove={e=>{if(!drag.current||!viewport)return;setBox(originalRect(viewport,normalized([...drag.current,...point(e)])));}}
      onPointerUp={e=>{if(drag.current&&viewport){const sr=normalized([...drag.current,...point(e)]);drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);if(sr[2]-sr[0]<8||sr[3]-sr[1]<8){setBox(null);return;}const r=originalRect(viewport,sr);setBox(r);setPreview(previewFor(r));setMode('text');}else requestAnimationFrame(selectedText);}}
      onClick={e=>{if(mode!=='text'||box||!window.getSelection()?.isCollapsed||!viewport)return;const xy=viewport.convertToPdfPoint(...point(e));const hit=marks.find(i=>i.anchor.pdf!.rects.some(r=>xy[0]>=r[0]&&xy[0]<=r[2]&&xy[1]>=r[1]&&xy[1]<=r[3]));if(hit)props.onActivate?.(hit.id);}}>
      {near?<><canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} /><div ref={native} className="pdf-native textLayer"/></>:<div className="pdf-page-placeholder">第 {page} 页</div>}
      <div ref={ocrLayer} className="pdf-ocr">{near&&viewport?ocr.map(o=><div key={o.id} data-ocr-id={o.id}>{o.data.lines.map((l,n)=>{const r=screenRect(viewport,l.rect);return <span key={n} data-line={n} data-width={r[2]-r[0]} style={{left:r[0],top:r[1],fontSize:r[3]-r[1]}}>{l.text}{'\n'}</span>;})}</div>):null}</div>
      {near&&viewport?marks.flatMap(i=>i.anchor.pdf!.rects.map((r,n)=><div key={i.id+'-'+n} data-pdf-inquiry={i.id} className={`pdf-mark ${i.anchor.pdf!.kind} ${props.activeId===i.id?'active':''}`} style={rectStyle(screenRect(viewport,r))}>{n===0?<button type="button" aria-label={`查看知识贴：${i.anchor.quote}`} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();props.onActivate?.(i.id);}}>↗</button>:null}</div>)):null}
      {box&&viewport?<div className="pdf-draft-box" style={rectStyle(screenRect(viewport,box))}/>:null}
    </div></div>
    {(preview&&box)||selection?<div ref={card} className="pdf-selection-card" role="region" aria-label="选区操作" onPointerUp={e=>e.stopPropagation()}>
      {selection?<p className="pdf-selected-quote">{quote}</p>:<img src={preview} alt="本次选择的原页区域" />}
      <div className="pdf-card-actions">{(['explain','verify','entity']as const).map((intent,n)=><button key={intent} type="button" disabled={busy||props.readOnly} onClick={()=>{if(selection)create(intent,selection.anchor);else void selectRegion(intent);}}>{['解释概念','查找来源','介绍一下'][n]}</button>)}</div>
      {busy?<p role="status">{status}</p>:null}
      <button type="button" onClick={cancel}>取消</button>
    </div>:null}
  </section>;
}
