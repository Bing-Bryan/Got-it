import type {PDFPageProxy} from 'pdfjs-dist';
import type {PdfRect} from './pdf-data';
import {originalRect,screenRect} from './pdf-geometry';

// Selected regions are re-rendered from the PDF's vector source instead of being
// cut from the on-screen canvas: small chart labels are unreadable at screen
// resolution (artifacts/hosted-web-trial/vision-isolation.md).
export const REGION_MAX_SCALE=4;
export const REGION_MAX_PIXELS=2_500_000;
export const REGION_MAX_SIDE=4096;
// Below this many pixels per PDF point, small labels may become unreadable.
export const REGION_DETAIL_SCALE=3;

export function regionScale(rect:PdfRect):number{
  const w=Math.abs(rect[2]-rect[0]),h=Math.abs(rect[3]-rect[1]);
  if(!(w>0&&h>0))return 0;
  return Math.min(REGION_MAX_SCALE,Math.sqrt(REGION_MAX_PIXELS/(w*h)),REGION_MAX_SIDE/w,REGION_MAX_SIDE/h);
}

export const regionNeedsSmallerSelection=(rect:PdfRect)=>regionScale(rect)<REGION_DETAIL_SCALE;

function toPng(canvas:HTMLCanvasElement):Promise<Blob>{
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('所选区域无法生成图片。')),'image/png'));
}

export interface RenderedRegion {blob:Blob;canvas:HTMLCanvasElement;width:number;height:number;scale:number;
  /** Maps a pixel box on the rendered canvas back to PDF coordinates (for OCR lines). */
  toPdfRect:(box:[number,number,number,number])=>PdfRect}
export async function renderRegion(page:PDFPageProxy,rect:PdfRect,maxBytes:number,signal?:AbortSignal):Promise<RenderedRegion>{
  const scale=regionScale(rect);
  if(!scale)throw new Error('所选区域无效，请重新框选。');
  const viewport=page.getViewport({scale});
  const s=screenRect(viewport,rect);
  let canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(s[2]-s[0]));canvas.height=Math.max(1,Math.round(s[3]-s[1]));
  const task=page.render({canvas,viewport,transform:[1,0,0,1,-s[0],-s[1]]});
  const stop=()=>task.cancel();
  signal?.addEventListener('abort',stop,{once:true});
  try{await task.promise;}finally{signal?.removeEventListener('abort',stop);}
  signal?.throwIfAborted();
  let blob=await toPng(canvas);
  // Photo-like regions can exceed the byte limit; shrink until it holds.
  while(blob.size>maxBytes&&canvas.width>1&&canvas.height>1){
    const smaller=document.createElement('canvas');
    smaller.width=Math.max(1,Math.floor(canvas.width*.8));smaller.height=Math.max(1,Math.floor(canvas.height*.8));
    smaller.getContext('2d')!.drawImage(canvas,0,0,smaller.width,smaller.height);
    canvas=smaller;blob=await toPng(canvas);signal?.throwIfAborted();
  }
  if(blob.size>maxBytes)throw new Error('所选区域图片过大，请缩小范围。');
  const shrink=canvas.width/Math.max(1,Math.round(s[2]-s[0]));
  const toPdfRect=(b:[number,number,number,number])=>originalRect(viewport,[b[0]/shrink+s[0],b[1]/shrink+s[1],b[2]/shrink+s[0],b[3]/shrink+s[1]]);
  return {blob,canvas,width:canvas.width,height:canvas.height,scale:scale*shrink,toPdfRect};
}
