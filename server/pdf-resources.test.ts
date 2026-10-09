// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile,rename,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {PNG} from 'pngjs';
import {ReadingLibrary} from './reading-library';import {pdfFixture} from './test-support/pdf-fixture';
import {restoreWorkspace} from '../src/lib/storage';import {parseReadingDocument,workspaceToReadingDocument} from '../src/lib/reading-document-core';
import {workspaceToJson,workspaceToMarkdown} from '../src/lib/export';
import {MAX_PDF_BYTES} from '../src/lib/pdf-data';
import type {LibraryEntry} from '../src/lib/library-types';
let dirs:string[]=[];afterEach(async()=>{vi.restoreAllMocks();await Promise.all(dirs.map(d=>rm(d,{recursive:true,force:true})));dirs=[];});
async function setup(){const dir=await mkdtemp(join(tmpdir(),'got-it-pdf-test-'));dirs.push(dir);const source=join(dir,'source.pdf');await writeFile(source,pdfFixture(3));const library=new ReadingLibrary(join(dir,'library'),async()=>source);const selected=await library.choose();const entry=await library.add(selected!.workspace,'first',selected!.selectionId);return {dir,source,library,entry};}
const crop=()=>PNG.sync.write(new PNG({width:20,height:20,fill:true}));
it('imports native/browser PDFs separately, reuses native paths and restores immutable pages after restart',async()=>{
 const s=await setup();expect(s.entry.workspace.document.kind).toBe('pdf');const selected=await s.library.choose();expect((await s.library.add(selected!.workspace,'again',selected!.selectionId)).id).toBe(s.entry.id);
 const browser=await s.library.uploadPdf('same.pdf',pdfFixture(3));const second=await s.library.add(browser.workspace,'browser',browser.selectionId);expect(second.id).not.toBe(s.entry.id);expect(second.source).toBeNull();
 const next=new ReadingLibrary(s.library.dir);const e=await next.get(s.entry.id);expect(e.workspace.document).toEqual(s.entry.workspace.document);expect((await next.resources.read(e.id,e.workspace.document.contentHash)).bytes.equals(pdfFixture(3))).toBe(true);
});
it('requires upload authority; rejects fake metadata, outside-page anchors, external records and invalid formats',async()=>{
 const s=await setup();const w=s.entry.workspace;
 await expect(s.library.add(w,'fake')).rejects.toThrow('上传');
 expect(()=>parseReadingDocument(JSON.stringify(w),true)).toThrow('PDF');
 expect(()=>workspaceToReadingDocument(w)).toThrow('PDF');expect(()=>workspaceToJson(w)).toThrow('PDF');expect(()=>workspaceToMarkdown(w)).toThrow('PDF');
 await expect(s.library.resources.read(crypto.randomUUID(),w.document.contentHash)).rejects.toThrow('资源');await expect(s.library.resources.read(s.entry.id,'../../secret')).rejects.toThrow();
 await expect(s.library.uploadPdf('bad.pdf',Buffer.from('%PDF-broken'))).rejects.toThrow('损坏');await expect(s.library.uploadPdf('huge.pdf',Buffer.alloc(MAX_PDF_BYTES+1))).rejects.toThrow('50');await expect(s.library.uploadPdf('many.pdf',pdfFixture(201))).rejects.toThrow('200');
 const raw=structuredClone(w);if(raw.document.kind==='pdf')raw.document.pdf.pages[0].rotation=45;expect(restoreWorkspace(raw)).toBeNull();
});
it('persists OCR and crops before references, rejects spoofed provenance and preserves history on source changes',async()=>{
 const s=await setup();const fileHash=s.entry.workspace.document.contentHash;
 const ocr=await s.library.resources.ocr(s.entry.id,{version:1,fileHash,page:1,lines:[{text:'Alpha 10',rect:[70,230,150,250],block:'a'}]});
 const {id}=await s.library.resources.crop(s.entry.id,fileHash,1,[70,60,300,200],crop());
 await expect(s.library.resources.crop(s.entry.id,fileHash,1,[-10,0,50,50],crop())).rejects.toThrow();await expect(s.library.resources.crop(s.entry.id,fileHash,1,[0,0,20,20],Buffer.from('bad'))).rejects.toThrow();
 const w=structuredClone(s.entry.workspace);w.inquiries=[{id:'image-1',intent:'explain',question:'chart',status:'ready',createdAt:'2026',updatedAt:'2026',understanding:'',messages:[{id:'a',role:'assistant',content:'synthetic answer',createdAt:'2026'}],anchor:{documentId:w.document.id,blockId:'pdf-1',headingPath:[],quote:'chart',prefix:'',suffix:'',start:0,end:0,matchStatus:'matched',pdf:{kind:'region',source:'image',fileHash,page:1,rects:[[70,60,300,200]],cropId:id}}}];
 const saved=await s.library.save(s.entry.id,s.entry.version,s.entry.revisionId,w,{ratio:.2,pdfPage:1,pdfZoom:1.5});expect(saved.position.pdfZoom).toBe(1.5);
 const forged=structuredClone(w);forged.inquiries[0].anchor.pdf!.page=2;await expect(s.library.save(saved.id,saved.version,saved.revisionId,forged,{})).rejects.toThrow();
 await writeFile(s.source,pdfFixture(4));const change=await s.library.check(saved.id);const updated=await s.library.updateSource(saved.id,change.candidateId!,saved.version);expect(updated.history[0].workspace.inquiries[0].messages[0].content).toBe('synthetic answer');expect((await s.library.resources.read(saved.id,id)).bytes).toEqual(crop());expect((await s.library.resources.read(saved.id,ocr.id)).meta.kind).toBe('ocr');
});
it('refuses to declare persistence when binary writes fail and leaves existing entry intact',async()=>{
 const s=await setup();const before=await s.library.get(s.entry.id);await rm(join(s.library.dir,'resources','objects'),{recursive:true});await writeFile(join(s.library.dir,'resources','objects'),'blocked');
 await expect(s.library.uploadPdf('new.pdf',pdfFixture(2))).rejects.toThrow();expect((await s.library.get(s.entry.id)).workspace).toEqual(before.workspace);
});
it('keeps crop and PDF ownership when recovering a conflicting reading copy',async()=>{
 const s=await setup();const draft={id:crypto.randomUUID(),entryId:s.entry.id,version:s.entry.version,revisionId:s.entry.revisionId,baseDigest:s.entry.contentDigest,workspace:s.entry.workspace,position:{ratio:.5,pdfPage:2}};
 const same=await s.library.recover(s.entry.id,draft);expect(same.kind).toBe('same');expect((await s.library.get(s.entry.id)).position.pdfPage).toBe(2);
 const invalid=structuredClone(draft);invalid.workspace.document.contentHash='a'.repeat(64);await expect(s.library.recover(s.entry.id,invalid)).rejects.toThrow();
});

it('checks exact limits, encryption, PNG decoding and fails OCR writes without committing references',async()=>{
 const s=await setup(),h=s.entry.workspace.document.contentHash;
 await expect(s.library.uploadPdf('locked.pdf',pdfFixture(1,0,false,true))).rejects.toThrow('加密');
 const p=pdfFixture(1);const atLimit=Buffer.alloc(MAX_PDF_BYTES,32);p.copy(atLimit);expect((await s.library.uploadPdf('limit.pdf',atLimit)).workspace!.document.kind).toBe('pdf');
 expect((await s.library.uploadPdf('200.pdf',pdfFixture(200))).workspace!.document.kind).toBe('pdf');
 const rect=[70,60,300,200],tooWide=Buffer.from(crop());tooWide.writeUInt32BE(4097,16);
 await expect(s.library.resources.crop(s.entry.id,h,1,rect,tooWide)).rejects.toThrow('4096');
 await expect(s.library.resources.crop(s.entry.id,h,1,rect,Buffer.alloc(8*1024*1024+1))).rejects.toThrow('8 MiB');
 const badCRC=Buffer.from(crop());badCRC[29]^=255;await expect(s.library.resources.crop(s.entry.id,h,1,rect,badCRC)).rejects.toThrow('损坏');
 const internals=s.library.resources as unknown as {atomic:(p:string,b:unknown)=>Promise<void>};vi.spyOn(internals,'atomic').mockRejectedValue(new Error('ENOSPC'));
 await expect(s.library.resources.ocr(s.entry.id,{version:1,fileHash:h,page:1,lines:[{text:'test',rect,block:'a'}]})).rejects.toThrow('ENOSPC');expect((await s.library.get(s.entry.id)).version).toBe(s.entry.version);
});
it('relinks moved PDF bytes, rejects changed confirmation and changed symlink targets',async()=>{
 const s=await setup();const moved=join(s.dir,'moved.pdf');await rename(s.source,moved);expect((await s.library.check(s.entry.id)).status).toBe('missing');
 const l=new ReadingLibrary(s.library.dir,async()=>moved);const f=await l.choose();let e=(await l.relink(s.entry.id,f!.selectionId,s.entry.version)).entry;expect(e.source!.path).toBe(moved);
 await writeFile(moved,pdfFixture(2));let c=await l.check(e.id);await writeFile(moved,pdfFixture(4));await expect(l.updateSource(e.id,c.candidateId!,e.version)).rejects.toThrow('再次变化');c=await l.check(e.id);e=await l.updateSource(e.id,c.candidateId!,e.version);expect(e.history[0].workspace.document.contentHash).toBe(s.entry.workspace.document.contentHash);
 const link=join(s.dir,'link.pdf');await symlink(moved,link);const linked=new ReadingLibrary(join(s.dir,'links'),async()=>link);const selected=await linked.choose();const entry=await linked.add(selected!.workspace,'link',selected!.selectionId);await unlink(link);await writeFile(s.source,pdfFixture(1));await symlink(s.source,link);expect((await linked.check(entry.id)).status).toBe('reselect');
});
it('recovers both PDF conflict snapshots and replays a lost acknowledgement without duplicating resources or entries',async()=>{
 const s=await setup(),h=s.entry.workspace.document.contentHash;const savedCrop=await s.library.resources.crop(s.entry.id,h,1,[70,60,300,200],crop());
 const w=structuredClone(s.entry.workspace);w.inquiries=[{id:'conflict',intent:'explain',question:'chart',status:'ready',createdAt:'2026',updatedAt:'2026',understanding:'',messages:[{id:'a',role:'assistant',content:'draft answer',createdAt:'2026'}],anchor:{documentId:w.document.id,blockId:'pdf',headingPath:[],quote:'chart',prefix:'',suffix:'',start:0,end:0,matchStatus:'matched',pdf:{kind:'region',source:'image',fileHash:h,page:1,rects:[[70,60,300,200]],cropId:savedCrop.id}}}];
 const draft={id:crypto.randomUUID(),entryId:s.entry.id,version:s.entry.version,revisionId:s.entry.revisionId,baseDigest:s.entry.contentDigest,workspace:w,position:{ratio:.5,pdfPage:1,pdfZoom:2}};
 const disk=structuredClone(w);disk.inquiries[0].messages[0].content='disk answer';let current=await s.library.save(s.entry.id,s.entry.version,s.entry.revisionId,disk,{});
 await expect(s.library.save(s.entry.id,s.entry.version,s.entry.revisionId,w,{})).rejects.toMatchObject({status:409});
 const conflict=await s.library.recover(s.entry.id,draft);expect(conflict.kind).toBe('review');if(conflict.kind!=='review')throw new Error();
 const retained=(await s.library.resolveRecovery(conflict.record.id,'draft',current.version));expect(retained.record.disk!.workspace.inquiries[0].messages[0].content).toBe('disk answer');
 await writeFile(s.source,pdfFixture(4));const change=await s.library.check(s.entry.id);current=await s.library.updateSource(s.entry.id,change.candidateId!,retained.entry.version);
 const old=await s.library.recover(s.entry.id,draft);if(old.kind!=='review')throw new Error();
 // A different draft ID avoids reusing the already resolved conflict operation.
 const fork=await s.library.recover(s.entry.id,{...draft,id:crypto.randomUUID()});if(fork.kind!=='review')throw new Error();
 const internal=s.library as unknown as {commit:(e:LibraryEntry)=>Promise<LibraryEntry>};const commit=internal.commit.bind(s.library);vi.spyOn(internal,'commit').mockImplementationOnce(async e=>{await commit(e);throw new Error('response lost');});
 await expect(s.library.resolveRecovery(fork.record.id,'draft',current.version)).rejects.toThrow('response lost');
 const restart=new ReadingLibrary(s.library.dir);const result=await restart.resolveRecovery(fork.record.id,'draft',current.version);expect(result.entry.id).not.toBe(s.entry.id);expect((await restart.list()).entries).toHaveLength(2);expect((await restart.resources.read(result.entry.id,savedCrop.id)).bytes).toEqual(crop());expect(result.entry.position.pdfZoom).toBe(2);
 const snapshots=await restart.getRecovery(conflict.record.id);for(const snapshot of [snapshots.draft,snapshots.disk!])await restart.resources.validate(s.entry.id,snapshot.workspace);
 expect((await restart.add(s.entry.workspace,'first','expired')).id).toBe(s.entry.id);
});
it('validates both crop and auxiliary OCR ownership, page and file when reopening an image anchor',async()=>{
 const s=await setup(),fileHash=s.entry.workspace.document.contentHash;
 const rect:[number,number,number,number]=[70,60,300,200];const cropId=(await s.library.resources.crop(s.entry.id,fileHash,1,rect,crop())).id;
 const recognized=await s.library.resources.ocr(s.entry.id,{version:1,fileHash,page:1,lines:[{text:'Alpha',rect:[80,80,120,100],block:'r'}]});
 const a={kind:'region' as const,source:'image' as const,fileHash,page:1,rects:[rect],cropId,ocrId:recognized.id,originalText:'Alpha',context:'Corrected Alpha'};
 expect(await s.library.resources.location(s.entry.id,a)).toEqual(crop());
 const wrong=await s.library.resources.ocr(s.entry.id,{version:1,fileHash,page:2,lines:[{text:'Beta',rect:[80,80,120,100],block:'r'}]});
 await expect(s.library.resources.location(s.entry.id,{...a,ocrId:wrong.id})).rejects.toThrow();
 await expect(s.library.resources.location(s.entry.id,{...a,ocrId:cropId})).rejects.toThrow();
 const {copyPdfLocation}=await import('../src/lib/pdf-data');expect(copyPdfLocation(a)).toEqual(a);
});


it('reopens old learning and corrected OCR records without dropping original resources',async()=>{
 const {library,entry}=await setup();const fileHash=entry.workspace.document.contentHash;
 const rect:[number,number,number,number]=[70,60,300,200];
 const cropId=(await library.resources.crop(entry.id,fileHash,1,rect,crop())).id;
 const ocr=await library.resources.ocr(entry.id,{version:1,fileHash,page:1,lines:[{text:'Alpha 1O',rect:[80,80,120,100],block:'r'}]});
 const workspace=structuredClone(entry.workspace);
 workspace.inquiries=[{id:'legacy',intent:'explain',question:'chart',status:'distilled',understanding:'旧理解',completedAt:'2026-01-01',createdAt:'2026',updatedAt:'2026',messages:[{id:'answer',role:'assistant',content:'旧回答',createdAt:'2026',completion:'complete'}],anchor:{documentId:workspace.document.id,blockId:'pdf-1',headingPath:[],quote:'图表',prefix:'',suffix:'',start:0,end:0,matchStatus:'matched',pdf:{kind:'region',source:'image',fileHash,page:1,rects:[rect],cropId,ocrId:ocr.id,originalText:'Alpha 1O',context:'Alpha 10'}}}];
 await library.save(entry.id,entry.version,entry.revisionId,workspace,{});
 const restart=new ReadingLibrary(library.dir),restored=await restart.get(entry.id);
 expect(restored.workspace.inquiries).toEqual(workspace.inquiries);
 expect((await restart.resources.read(entry.id,cropId)).bytes).toEqual(crop());
 expect((await restart.resources.read(entry.id,ocr.id)).meta.kind).toBe('ocr');
 expect((await restart.resources.read(entry.id,fileHash)).bytes).toEqual(pdfFixture(3));
});
