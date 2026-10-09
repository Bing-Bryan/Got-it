import {getDocument,GlobalWorkerOptions,Util,type PDFDocumentProxy} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {createWorker,PSM,type RecognizeResult} from 'tesseract.js';
import {libraryBinary} from './library-client';
import {abortable} from './abortable';
import {cleanTitle,pageHeading,type OutlineLine,type PdfOutlineItem} from './pdf-outline';
GlobalWorkerOptions.workerSrc=workerUrl;
async function bookmarkItems(pdf:PDFDocumentProxy,signal:AbortSignal){
  const roots=await abortable(pdf.getOutline(),signal),items:PdfOutlineItem[]=[];
  async function visit(nodes:NonNullable<typeof roots>,level:number){
    for(const node of nodes){
      if(items.length>=600)return;
      signal.throwIfAborted();
      try{
        const dest=typeof node.dest==='string'?await pdf.getDestination(node.dest):node.dest;
        if(dest){const index=typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0]);
          if(index>=0&&index<pdf.numPages&&node.title.trim()){
            const page=await pdf.getPage(index+1),v=page.getViewport({scale:1});
            const y=dest[1]?.name==='XYZ'?dest[3]:dest[1]?.name==='FitH'?dest[2]:null;
            const top=typeof y==='number'?Math.max(0,Math.min(1,v.convertToViewportPoint(0,y)[1]/v.height)):0;
            items.push({id:`bookmark-${items.length}`,title:cleanTitle(node.title).slice(0,160),page:index+1,top,level:Math.min(3,level)as 1|2|3,source:'bookmark'});
          }
        }
      }catch(e){signal.throwIfAborted();/* Broken destinations do not prevent other bookmarks. */}
      if(items.length>=600)return;
      if(node.items.length)await visit(node.items,level+1);
    }
  }
  if(roots)await visit(roots,1);return items;
}
function ocrLines(recognized:RecognizeResult,width:number,height:number):OutlineLine[]{
  return (recognized.data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines)).filter(l=>l.confidence>=60).map(l=>{
    const heights=l.words.filter(w=>w.confidence>=50).map(w=>w.bbox.y1-w.bbox.y0).sort((a,b)=>a-b);
    const h=heights.length?heights[Math.floor(heights.length/2)]:l.bbox.y1-l.bbox.y0;
    return {text:l.text,x:l.bbox.x0/width,y:l.bbox.y0/height,width:(l.bbox.x1-l.bbox.x0)/width,height:h/height};
  });
}
export async function generatePdfOutline(entryId:string,hash:string,signal:AbortSignal,progress:(text:string)=>void):Promise<PdfOutlineItem[]>{
  signal.throwIfAborted();
  signal=AbortSignal.any([signal,AbortSignal.timeout(15*60*1000)]);
  progress('正在读取原文件目录…');
  const response=await abortable(libraryBinary(`/entries/${entryId}/resources/${hash}`),signal);
  const bytes=await abortable(response.arrayBuffer(),signal);signal.throwIfAborted();
  const task=getDocument({data:new Uint8Array(bytes),cMapUrl:'/pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-assets/standard_fonts/',wasmUrl:'/pdf-assets/wasm/',enableXfa:false});
  let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
  const stop=()=>{void task.destroy();void worker?.terminate().catch(()=>{});};signal.addEventListener('abort',stop,{once:true});
  try{
    const pdf=await abortable(task.promise,signal),bookmarks=await bookmarkItems(pdf,signal);
    if(bookmarks.length)return bookmarks;
    const result:PdfOutlineItem[]=[];
    for(let n=1;n<=pdf.numPages;n++){
      signal.throwIfAborted();progress(`正在本机识别目录 · ${n} / ${pdf.numPages} 页`);
      const page=await abortable(pdf.getPage(n),signal),v=page.getViewport({scale:1});
      const text=await abortable(page.getTextContent(),signal);
      const lines:OutlineLine[]=text.items.flatMap(i=>{
        if(!('str'in i)||!i.str.trim())return [];
        const t=Util.transform(v.transform,i.transform),h=Math.hypot(t[2],t[3]);
        return [{text:i.str,x:t[4]/v.width,y:(t[5]-h)/v.height,width:i.width/v.width,height:h/v.height}];
      });
      let heading=pageHeading(lines,n,'native');
      if(!heading){
        if(!worker){
          const startup=AbortSignal.any([signal,AbortSignal.timeout(60000)]);
          worker=await abortable(createWorker('chi_sim+eng',1,{workerPath:'/pdf-assets/worker.min.js',langPath:'/pdf-assets',corePath:'/pdf-assets'}).then(w=>{if(startup.aborted){void w.terminate();throw startup.reason;}return w;}),startup);
          if(!worker)throw new Error("本机识别器未能启动，请重试。");
          await abortable(worker.setParameters({tessedit_pageseg_mode:PSM.AUTO}),signal);
        }
        if(!worker)throw new Error("本机识别器未能启动，请重试。");
        const canvas=document.createElement('canvas');const view=page.getViewport({scale:Math.min(2.5,Math.sqrt(6_000_000/(v.width*v.height)))});
        canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
        const render=page.render({canvas,viewport:view});const cancelRender=()=>render.cancel();signal.addEventListener('abort',cancelRender,{once:true});
        try{await abortable(render.promise,signal);}finally{signal.removeEventListener('abort',cancelRender);}
        const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(new Error(`第 ${n} 页识别超时，请重试。`)),60000);
        const top=document.createElement('canvas');top.width=canvas.width;top.height=Math.ceil(canvas.height*.1);
        top.getContext('2d')!.drawImage(canvas,0,0);
        try{
          const pageSignal=AbortSignal.any([signal,timeout.signal]);
          const full=await abortable(worker.recognize(canvas,{}, {blocks:true}),pageSignal);
          heading=pageHeading(ocrLines(full,view.width,view.height),n,'ocr');
          if(!heading){
            // A separate top band recovers short headings lost among photographs. Keep full-page
            // context as the primary read: cropping can also reduce OCR recognition quality.
            const first=await abortable(worker.recognize(top,{}, {blocks:true}),pageSignal);
            const header=ocrLines(first,view.width,view.height).filter(l=>l.y<.075&&l.height>=.016&&l.text.length<100);
            heading=pageHeading(header,n,'ocr');
          }
        }finally{clearTimeout(timer);canvas.width=0;canvas.height=0;top.width=0;top.height=0;}

      }
      if(heading)result.push(heading);page.cleanup();
    }
    // Remove a repeated running header, but keep repeated section names with separate page destinations.
    const counts=new Map<string,number>();for(const item of result)counts.set(item.title,(counts.get(item.title)??0)+1);
    const filtered=result.filter(i=>(counts.get(i.title)??0)<Math.max(4,pdf.numPages*.6));
    if(!filtered.some(i=>i.level===1))for(const i of filtered)i.level=1;
    return filtered;
  }finally{signal.removeEventListener('abort',stop);await worker?.terminate().catch(()=>{});await task.destroy().catch(()=>{});}
}
