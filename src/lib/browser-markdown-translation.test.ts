import 'fake-indexeddb/auto';
import {webcrypto} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
const hosted=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('./hosted-web-client',()=>({hostedOperationRequest:hosted.request,hostedOperationFetch:vi.fn(),cancelHostedOperation:vi.fn(),releaseHostedOperation:vi.fn()}));
const loader=vi.hoisted(()=>({bytes:[] as Uint8Array[]}));
// pdf.js is not run under jsdom; the loader still reads the stored file through the library.
vi.mock('./pdf-translation-loader',async()=>{const {pdfSourceFromPages}=await import('./pdf-translation');return {loadPdfTranslationSource:async(resourceId:string,read:()=>Promise<Uint8Array>)=>{loader.bytes.push(await read());return pdfSourceFromPages([{page:1,scanned:false,paragraphs:[{id:'pdf-p1-b0',page:1,text:'A synthetic PDF paragraph for the hosted path.',rects:[[72,700,300,712]]}]},{page:2,scanned:true,paragraphs:[]}],resourceId);}};});
import {browserRequest,browserBackup,restoreBrowserBackup} from './browser-library';
import {canonical} from './reading-recovery';
import {pdfTranslationVersion} from './pdf-translation';
import {readDocumentFile} from './reading-document-core';
import {documentTranslationSource} from './document-translation';
import type {LibraryEntry} from './library-types';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
beforeEach(async()=>{hosted.request.mockReset().mockResolvedValue({ok:true});await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('got-it.browser-library.v1');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});});
const text='# Notes\n\nThe first paragraph explains the idea in plain English for the reader.\n\nA second paragraph keeps `inline code` unchanged for the reader.\n';

it('forwards hosted Markdown batches with units rebuilt from the stored original',async()=>{
 const w=await readDocumentFile({name:'notes.md',size:text.length,text:async()=>text});
 const e=await browserRequest<LibraryEntry>('/entries',{workspace:w,creationKey:'md'});
 const {source,sourceVersion}=documentTranslationSource(e.workspace.document)!;
 const unitIds=source.units.map(u=>u.id);
 await browserRequest(`/entries/${e.id}/translation-batches`,{operationId:'op-1',roundId:'round',revisionId:e.revisionId,sourceVersion,translationId:'tr-1',unitIds});
 const [path,,body]=hosted.request.mock.calls[0];
 expect(path).toBe('/translation-batches');expect(body.sourceVersion).toBe(sourceVersion);
 expect(body.units.map((u:{id:string})=>u.id)).toEqual(unitIds);expect(JSON.stringify(body.units)).not.toContain('inline code');
});

it('refuses stale versions and injected unit ids without contacting the hosted service',async()=>{
 const w=await readDocumentFile({name:'notes.md',size:text.length,text:async()=>text});
 const e=await browserRequest<LibraryEntry>('/entries',{workspace:w,creationKey:'md'});
 const {sourceVersion}=documentTranslationSource(e.workspace.document)!;
 await expect(browserRequest(`/entries/${e.id}/translation-batches`,{operationId:'op-2',roundId:'r',revisionId:e.revisionId,sourceVersion:'b'.repeat(64),translationId:'t',unitIds:['x']})).rejects.toThrow('版本不匹配');
 await expect(browserRequest(`/entries/${e.id}/translation-batches`,{operationId:'op-3',roundId:'r',revisionId:e.revisionId,sourceVersion,translationId:'t',unitIds:['injected--v2-part0']})).rejects.toThrow('超出范围');
 expect(hosted.request).not.toHaveBeenCalled();
});

it('forwards hosted PDF batches with units rebuilt from the stored PDF bytes',async()=>{
 const w=await readDocumentFile({name:'notes.md',size:text.length,text:async()=>text});
 await browserRequest<LibraryEntry>('/entries',{workspace:w,creationKey:'md'});
 const pdfBytes=new TextEncoder().encode('%PDF-fixture'),digest=async(b:Uint8Array|string)=>Buffer.from(await crypto.subtle.digest('SHA-256',typeof b==='string'?new TextEncoder().encode(b):new Uint8Array(b))).toString('hex'),pdfId=await digest(pdfBytes);
 const raw=JSON.parse(await browserBackup());raw.payload.entries[0].workspace.document={id:'pdf',kind:'pdf',filename:'x.pdf',contentHash:pdfId,isDemo:false,importedAt:new Date().toISOString(),pdf:{resourceId:pdfId,pages:[{view:[0,0,612,792],rotation:0},{view:[0,0,612,792],rotation:0}]}};
 raw.payload.resources.push({id:pdfId,type:'application/pdf',base64:Buffer.from(pdfBytes).toString('base64')});raw.sha256=await digest(canonical(raw.payload));
 await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('got-it.browser-library.v1');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});
 await restoreBrowserBackup(JSON.stringify(raw));
 const e=(await browserRequest<{entries:{id:string}[]}>()).entries[0],full=await browserRequest<LibraryEntry>(`/entries/${e.id}`),sourceVersion=pdfTranslationVersion(pdfId);
 await expect(browserRequest(`/entries/${e.id}/translation-batches`,{operationId:'op-p0',roundId:'r',revisionId:full.revisionId,sourceVersion,translationId:'t',unitIds:['pdf-p2-b0--v2-part0']})).rejects.toThrow('超出范围');
 await browserRequest(`/entries/${e.id}/translation-batches`,{operationId:'op-p1',roundId:'r',revisionId:full.revisionId,sourceVersion,translationId:'t',unitIds:['pdf-p1-b0--v2-part0']});
 expect(Buffer.from(loader.bytes[0]).toString()).toBe('%PDF-fixture');
 const body=hosted.request.mock.calls[0][2];expect(body.sourceVersion).toBe(sourceVersion);expect(body.units).toEqual([{id:'pdf-p1-b0--v2-part0',blockId:'pdf-p1-b0',text:'A synthetic PDF paragraph for the hosted path.'}]);
});
