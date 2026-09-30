export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
export const MAX_CROP_BYTES = 8 * 1024 * 1024;
export type PdfRect = [number, number, number, number];
export interface PdfPageInfo { view: PdfRect; rotation: number }
export interface PdfDocumentData { resourceId: string; pages: PdfPageInfo[] }
export interface PdfLocation {
  kind: 'text' | 'region'; fileHash: string; page: number; rects: PdfRect[];
  source: 'native' | 'ocr' | 'image'; ocrId?: string; originalText?: string; context?: string; cropId?: string;
}
export interface PdfTextLine { text: string; rect: PdfRect; block: string }
export interface PdfOcrData { version: 1; fileHash: string; page: number; lines: PdfTextLine[] }
export const resourceId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function validRect(r: unknown): r is PdfRect { return Array.isArray(r) && r.length===4 && r.every(n=>typeof n==='number' && Number.isFinite(n) && Math.abs(n)<=1e6) && r[2]>r[0] && r[3]>r[1]; }
export function copyPdfDocument(value: unknown): PdfDocumentData | undefined {
  const v=value as PdfDocumentData | null;
  if(!v || !resourceId(v.resourceId) || !Array.isArray(v.pages) || !v.pages.length || v.pages.length>MAX_PDF_PAGES || !v.pages.every(p=>p && validRect(p.view) && [0,90,180,270].includes(p.rotation)))return;
  return {resourceId:v.resourceId,pages:v.pages.map(p=>({view:[...p.view],rotation:p.rotation}))};
}
export function copyPdfLocation(value: unknown): PdfLocation | undefined {
  const v=value as PdfLocation|null;
  if(!v || !['text','region'].includes(v.kind) || !resourceId(v.fileHash) || !Number.isInteger(v.page) || v.page<1 || v.page>MAX_PDF_PAGES || !Array.isArray(v.rects) || !v.rects.length || v.rects.length>500 || !v.rects.every(validRect) || !['native','ocr','image'].includes(v.source))return;
  if(v.kind==='region' && (v.source!=='image' || v.rects.length!==1 || !resourceId(v.cropId)))return;
  if(v.kind==='text' && (v.source==='image' || (v.source==='ocr' && !resourceId(v.ocrId))))return;
  if(v.kind==='text' && v.cropId!==undefined)return;
  if(v.source!=='ocr' && v.kind!=='region' && v.ocrId!==undefined)return;
  if(v.cropId!==undefined && !resourceId(v.cropId))return;
  if(v.ocrId!==undefined && !resourceId(v.ocrId))return;
  return {kind:v.kind,fileHash:v.fileHash,page:v.page,rects:v.rects.map(r=>[...r]),source:v.source,
    ...(v.ocrId?{ocrId:v.ocrId}:{}),...(v.cropId?{cropId:v.cropId}:{}),
    ...(typeof v.originalText==='string'?{originalText:v.originalText.slice(0,20000)}:{}),...(typeof v.context==='string'?{context:v.context.slice(0,4000)}:{})};
}
export function insidePage(r: PdfRect,p: PdfPageInfo) { return r[0]>=p.view[0]-.1 && r[1]>=p.view[1]-.1 && r[2]<=p.view[2]+.1 && r[3]<=p.view[3]+.1; }
export function copyOcr(value: unknown): PdfOcrData | undefined {
 const v=value as PdfOcrData|null;
 if(!v || v.version!==1 || !resourceId(v.fileHash) || !Number.isInteger(v.page) || v.page<1 || v.page>200 || !Array.isArray(v.lines) || v.lines.length>10000 || !v.lines.every(l=>l && typeof l.text==='string' && l.text.length<=10000 && typeof l.block==='string' && l.block.length<100 && validRect(l.rect)))return;
 return {version:1,fileHash:v.fileHash,page:v.page,lines:v.lines.map(l=>({text:l.text,rect:[...l.rect],block:l.block}))};
}
