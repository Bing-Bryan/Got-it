import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { copyOcr, copyPdfDocument, insidePage, resourceId, validRect, MAX_CROP_BYTES, MAX_PDF_BYTES, MAX_PDF_PAGES, type PdfDocumentData, type PdfLocation, type PdfRect } from '../src/lib/pdf-data';
import type { Workspace } from '../src/types';
import { LibraryError } from './file-picker';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
interface Meta { kind: 'pdf' | 'ocr' | 'crop'; fileHash: string; page?: number; rect?: PdfRect; pdf?: PdfDocumentData }
function fail(message = 'PDF 资源无效或不属于此阅读条目。'): never { throw new LibraryError(message, 400, 'pdf_resource_invalid'); }
export class PdfResources {
  constructor(private root: string) {}
  private path(id: string, ext: string) { if (!resourceId(id)) fail(); return join(this.root, 'objects', `${id}.${ext}`); }
  private grantPath(owner: string, id: string) { if (!/^[a-f0-9-]{36}$/.test(owner) || !resourceId(id)) fail(); return join(this.root, 'owners', owner, id); }
  private async atomic(path: string, bytes: Uint8Array | string) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try { const f = await open(temp, 'wx', 0o600); try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); } await rename(temp, path); }
    finally { await rm(temp, {force: true}).catch(() => {}); }
  }
  private async syncDir(path:string){if(process.platform==='win32')return;const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
  private async put(bytes: Uint8Array, meta: Meta) {
    await mkdir(join(this.root, 'objects'), {recursive:true, mode:0o700});
    // Include provenance in the digest: equal pixels from different pages stay distinct.
    const id = meta.kind === 'pdf' ? sha(bytes) : sha(Buffer.concat([Buffer.from(JSON.stringify(meta)), Buffer.from(bytes)]));
    await this.atomic(this.path(id, 'bin'), bytes);
    await this.atomic(this.path(id, 'json'), JSON.stringify(meta));
    await this.syncDir(join(this.root,'objects'));
    return id;
  }
  async grant(owner: string, id: string) {
    const path=this.grantPath(owner,id); await this.meta(id);
    await mkdir(join(this.root,'owners',owner), {recursive:true,mode:0o700}); await this.atomic(path,'1');await this.syncDir(join(this.root,'owners',owner));
  }
  async meta(id: string): Promise<Meta> {
    try { return JSON.parse(await readFile(this.path(id,'json'),'utf8')); } catch { return fail('保存的 PDF 资源缺失或损坏，请重新关联原文件。'); }
  }
  async read(owner: string, id: string) {
    try { await access(this.grantPath(owner,id)); } catch { return fail(); }
    const meta=await this.meta(id); const bytes=await readFile(this.path(id,'bin'));
    const actual=meta.kind==='pdf'?sha(bytes):sha(Buffer.concat([Buffer.from(JSON.stringify(meta)),bytes]));
    if(actual!==id)fail('保存的 PDF 资源校验失败。');
    return {meta,bytes};
  }
  async pdf(bytes: Buffer): Promise<PdfDocumentData> {
    if(!Buffer.isBuffer(bytes) || !bytes.length || bytes.length>MAX_PDF_BYTES)fail('PDF 须不超过 50 MiB。');
    if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))fail('文件不是有效 PDF。');
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task=getDocument({data:new Uint8Array(bytes),stopAtErrors:true,useSystemFonts:false});
    try {
      const doc=await task.promise;
      if(doc.numPages>MAX_PDF_PAGES)fail('PDF 须不超过 200 页。');
      const pages=[];
      for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);pages.push({view:p.view as PdfRect,rotation:p.rotate});p.cleanup();}
      const pdf=copyPdfDocument({resourceId:sha(bytes),pages});if(!pdf)fail('PDF 页面尺寸无效。');
      await this.put(bytes,{kind:'pdf',fileHash:pdf.resourceId,pdf}); return pdf;
    } catch(e) { if(e instanceof LibraryError)throw e; return fail((e as Error).name==='PasswordException'?'暂不支持加密 PDF。':'PDF 损坏或无法解析。'); }
    finally { await task.destroy(); }
  }
  async page(owner:string,fileHash:string,page:number) {
    try { await access(this.grantPath(owner,fileHash)); } catch { return fail(); }
    const meta=await this.meta(fileHash);const p=meta.pdf?.pages[page-1];
    if(meta.kind!=='pdf'||!Number.isInteger(page)||!p)fail();return p;
  }
  async ocr(owner:string,value:unknown) {
    const data=copyOcr(value);if(!data || !data.lines.length)fail('识别结果为空或格式无效。');
    const page=await this.page(owner,data.fileHash,data.page);
    if(data.lines.some(l=>!insidePage(l.rect,page)))fail();
    const id=await this.put(Buffer.from(JSON.stringify(data)),{kind:'ocr',fileHash:data.fileHash,page:data.page});await this.grant(owner,id);return {id,data};
  }
  async crop(owner:string,fileHash:string,page:number,rect:unknown,bytes:Buffer) {
    const p=await this.page(owner,fileHash,page);if(!validRect(rect)||!insidePage(rect,p))fail();
    if(!Buffer.isBuffer(bytes) || bytes.length>MAX_CROP_BYTES || bytes.length<33 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('裁图必须是有效 PNG，且不超过 8 MiB。');
    // Check dimensions before decompression, then let the decoder verify chunks/CRC.
    if(bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||bytes[28]!==0)fail('裁图需为浏览器生成的非交错 PNG。');
    const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);if(!w||!h||w>4096||h>4096)fail('裁图尺寸须在 4096 × 4096 内。');
    try { const image=PNG.sync.read(bytes,{checkCRC:true});if(image.width!==w||image.height!==h)fail(); }catch {fail('裁图损坏，未保存。');}
    const id=await this.put(bytes,{kind:'crop',fileHash,page,rect});await this.grant(owner,id);return {id};
  }
  async validate(owner:string,w:Workspace) {
    if(w.document.kind!=='pdf')return;
    const {meta}=await this.read(owner,w.document.pdf.resourceId);
    if(JSON.stringify(meta.pdf)!==JSON.stringify(w.document.pdf))fail();
    for(const i of w.inquiries){const a=i.anchor.pdf;if(!a)fail();await this.location(owner,a);}
  }
  async location(owner:string,a:PdfLocation) {
    const page=await this.page(owner,a.fileHash,a.page);if(a.rects.some(r=>!insidePage(r,page)))fail();
    const id=a.kind==='region'?a.cropId:a.ocrId;if(!id)return;
    const {meta,bytes}=await this.read(owner,id);
    if(meta.fileHash!==a.fileHash||meta.page!==a.page||meta.kind!==(a.kind==='region'?'crop':'ocr'))fail();
    if(a.kind==='region'&&JSON.stringify(meta.rect)!==JSON.stringify(a.rects[0]))fail();
    if(a.kind==='region'&&a.ocrId){const o=await this.read(owner,a.ocrId);if(o.meta.kind!=='ocr'||o.meta.fileHash!==a.fileHash||o.meta.page!==a.page)fail();}
    return bytes;
  }
  async clone(from:string,to:string,w:Workspace) {
    await this.validate(from,w);if(w.document.kind!=='pdf')return;
    const ids=new Set([w.document.pdf.resourceId,...w.inquiries.flatMap(i=>[i.anchor.pdf?.cropId,i.anchor.pdf?.ocrId]).filter((x):x is string=>!!x)]);
    for(const id of ids)await this.grant(to,id);
  }
}
