// @vitest-environment node
import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, open, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';import { join } from 'node:path';import { randomUUID } from 'node:crypto';
import { Bookmarks } from './bookmarks';import { ReadingLibrary } from './reading-library';import { bookmarkSourceBlocks } from './bookmark-source';
import { createAnchor } from '../src/lib/anchors';import { readDocumentFile } from '../src/lib/reading-document-core';import { pdfFixture } from './test-support/pdf-fixture';import type { Anchor } from '../src/types';
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,open:vi.fn(actual.open)};});
const dirs:string[]=[];afterEach(async()=>{vi.restoreAllMocks();await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function setup(markdown='# Source title only\n\n保存与恢复。 The COMPLETE original survives.\n\n相同原句。\n\n相同原句。'){
 const dir=await mkdtemp(join(tmpdir(),'got-it-bookmarks-'));dirs.push(dir);const library=new ReadingLibrary(join(dir,'data'));const workspace=await readDocumentFile({name:'Synthetic.md',size:Buffer.byteLength(markdown),text:async()=>markdown}),entry=await library.add(workspace,randomUUID()),store=new Bookmarks(library);
 const make=(quote:string,occurrence=0)=>{const matches=[...bookmarkSourceBlocks(entry.workspace)].filter(([,text])=>text.includes(quote));const [blockId,text]=matches[occurrence];return {entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor:createAnchor({documentId:entry.workspace.document.id,blockId,blockText:text,start:text.indexOf(quote),end:text.indexOf(quote)+quote.length})!};};
 return{dir,library,entry,store,make};
}
it('commits independently, restores after service restart and ignores late workspace save/import',async()=>{
 const s=await setup(),input=s.make('保存与恢复');const result=await s.store.create(input);expect(result.created).toBe(true);expect((await new Bookmarks(new ReadingLibrary(s.library.dir)).list()).bookmarks[0].excerpt).toBe('保存与恢复');
 await s.library.save(s.entry.id,s.entry.version,s.entry.revisionId,{...s.entry.workspace,hasUnexportedChanges:true},{ratio:.5});
 const old=await readDocumentFile({name:'old.md',size:10,text:async()=>'# 旧材料\n\n不含收藏。'});await s.library.add(old,randomUUID());
 expect((await s.store.list()).bookmarks.map(b=>b.id)).toEqual([result.bookmark.id]);expect((await s.store.locate(result.bookmark.id)).bookmark.id).toBe(result.bookmark.id);
});
it('deduplicates concurrent tabs/operation retries but preserves identical wording at different positions',async()=>{
 const s=await setup(),input=s.make('相同原句',0);const [a,b]=await Promise.all([s.store.create(input),new Bookmarks(s.library).create({...input,operationId:randomUUID()})]);expect(a.bookmark.id).toBe(b.bookmark.id);expect([a.created,b.created]).toEqual([true,false]);
 expect((await s.store.create(input)).created).toBe(true);expect((await s.store.create(s.make('相同原句',1))).bookmark.id).not.toBe(a.bookmark.id);expect((await s.store.list()).total).toBe(2);
 await expect(s.store.create({...s.make('保存与恢复'),operationId:input.operationId})).rejects.toMatchObject({status:409});
});
it('conditional undo cannot delete an old record; delete is idempotent and a late create retry cannot revive it',async()=>{
 const s=await setup(),input=s.make('保存与恢复'),{bookmark}=await s.store.create(input);const duplicateInput={...input,operationId:randomUUID()};expect((await s.store.create(duplicateInput)).created).toBe(false);
 await expect(s.store.remove(bookmark.id,1,randomUUID())).rejects.toMatchObject({status:409});expect((await s.store.list()).total).toBe(1);
 await s.store.remove(bookmark.id,1,input.operationId);expect((await s.store.remove(bookmark.id,1)).deleted).toBe(false);expect((await s.store.list('恢复')).total).toBe(0);
 await expect(s.store.create(input)).rejects.toMatchObject({code:'bookmark_deleted'});await expect(s.store.create(duplicateInput)).rejects.toMatchObject({code:'bookmark_deleted'});expect((await s.store.create({...input,operationId:randomUUID()})).created).toBe(true);
});
it('retains committed records and exposes write failure; retry uses the original operation',async()=>{
 const s=await setup();await s.store.create(s.make('相同原句'));const before=await readFile(s.store.file,'utf8'),input=s.make('保存与恢复');
 vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error('simulated ENOSPC'),{code:'ENOSPC'}));
 await expect(s.store.create(input)).rejects.toMatchObject({code:'bookmark_write_failed'});expect(await readFile(s.store.file,'utf8')).toBe(before);expect((await s.store.list()).total).toBe(1);
 expect((await s.store.create(input)).created).toBe(true);expect((await readdir(s.store.dir)).filter(f=>f.endsWith('.tmp'))).toEqual([]);
});
it('isolates a corrupt record without deleting its raw data; unknown schema refuses writes',async()=>{
 const s=await setup();await s.store.create(s.make('保存与恢复'));let db=JSON.parse(await readFile(s.store.file,'utf8'));const corrupt={id:'broken',privateOriginal:'retained safety fixture',anchor:null};db.records.push(corrupt);await writeFile(s.store.file,JSON.stringify(db));
 expect((await s.store.list()).warnings[0]).toContain('隔离');await s.store.create(s.make('相同原句'));expect(JSON.parse(await readFile(s.store.file,'utf8')).records).toContainEqual(corrupt);
 db=JSON.parse(await readFile(s.store.file,'utf8'));db.schemaVersion=99;const future=JSON.stringify(db);await writeFile(s.store.file,future);await expect(s.store.create(s.make('相同原句',1))).rejects.toMatchObject({code:'bookmark_version'});expect(await readFile(s.store.file,'utf8')).toBe(future);
});
it('rejects forged positions/contexts/document links and region images without touching original records',async()=>{
 const s=await setup(),input=s.make('保存与恢复');await expect(s.store.create({...input,anchor:{...input.anchor,start:1,end:6}})).rejects.toMatchObject({status:409});
 await expect(s.store.create({...input,anchor:{...input.anchor,prefix:'FAKE'}})).rejects.toMatchObject({status:409});
 await expect(s.store.create({...input,anchor:{...input.anchor,documentId:'other'}})).rejects.toMatchObject({status:400});
 await expect(s.store.create({...input,entryId:'../../private'})).rejects.toMatchObject({status:400});
 await expect(s.store.create({...input,anchor:{...input.anchor,scope:'document'}})).rejects.toMatchObject({status:400});expect((await s.store.list()).total).toBe(0);expect((await s.library.get(s.entry.id)).workspace.inquiries).toEqual([]);
});
it('returns full long excerpt and trailing context, excludes source title/url, normalizes Unicode and English',async()=>{
 const tail='最终正确出口';const s=await setup('# HiddenTitleUnique\n\n'+('完整摘录。'.repeat(3000))+tail+' CONTEXT-END ＡＢＣ café');
 const long=s.make('完整摘录。'.repeat(3000)+tail),saved=await s.store.create(long);expect(saved.bookmark.excerpt.length).toBeGreaterThan(10_000);
 expect((await s.store.list(tail)).total).toBe(1);expect((await s.store.list('context-end abc')).total).toBe(1);expect((await s.store.list('HiddenTitleUnique')).total).toBe(0);expect((await s.store.list('Synthetic.md')).total).toBe(0);
 expect((await s.store.list(tail)).bookmarks[0].excerpt).toBe(saved.bookmark.excerpt);
});
// PDF.js engine/worker startup is fixture preparation, not bookmark validation time.
// Keep the bookmark assertions under the normal test timeout, with real resources.
let nativePdf:Awaited<ReturnType<typeof prepareNativePdf>>;
async function prepareNativePdf(){
 const dir=await mkdtemp(join(tmpdir(),'got-it-bookmark-native-pdf-'));
 try{const library=new ReadingLibrary(join(dir,'data')),candidate=await library.uploadPdf('safe.pdf',pdfFixture()),entry=await library.add(candidate.workspace!,randomUUID(),candidate.selectionId);return{dir,library,entry,store:new Bookmarks(library)};}
 catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
beforeAll(async()=>{nativePdf=await prepareNativePdf();});
afterAll(async()=>{if(nativePdf)await rm(nativePdf.dir,{recursive:true,force:true});});
it('validates PDF native resource/page/text and refuses region/forged text without OCR',async()=>{
 const s=nativePdf,entry=s.entry,quote='SYNTHETIC CHART 1';
 const a:Anchor={documentId:entry.workspace.document.id,blockId:'pdf-1-native',quote,prefix:'',suffix:'',headingPath:['第1页'],start:0,end:quote.length,matchStatus:'matched',pdf:{kind:'text',source:'native',fileHash:entry.workspace.document.contentHash,page:1,rects:[[70,245,280,270]]}};
 const input={entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor:a};const saved=await s.store.create(input);expect((await s.store.locate(saved.bookmark.id)).bookmark.anchor.pdf?.page).toBe(1);
 await expect(s.store.create({...input,operationId:randomUUID(),anchor:{...a,quote:'FAKE WORDING',end:12}})).rejects.toMatchObject({status:409});
 await expect(s.store.create({...input,anchor:{...a,pdf:{...a.pdf!,kind:'region',source:'image',cropId:'a'.repeat(64)}}})).rejects.toMatchObject({status:400});
});

it('keeps a bookmark tied to the exact retained revision and rejects writes from historical reading',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'got-it-bookmark-history-'));dirs.push(dir);const source=join(dir,'safe.md');await writeFile(source,'# 旧\n\n版本原句。');const library=new ReadingLibrary(join(dir,'data'),async()=>source),chosen=(await library.choose())!,w=await readDocumentFile({name:chosen.filename,size:Buffer.byteLength(chosen.content),text:async()=>chosen.content});let entry=await library.add(w,randomUUID(),chosen.selectionId);const [blockId,text]=[...bookmarkSourceBlocks(entry.workspace)].find(([,t])=>t.includes('版本原句'))!,store=new Bookmarks(library),anchor=createAnchor({documentId:w.document.id,blockId,blockText:text,start:0,end:4})!,request={entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor};const saved=await store.create(request);
 await writeFile(source,'# 新\n\n版本原句。\n\n另一个同句。');const check=await library.check(entry.id);entry=await library.updateSource(entry.id,check.candidateId!,entry.version);
 expect(entry.revisionId).not.toBe(request.revisionId);expect((await store.list('',0,50,{entryId:entry.id})).total).toBe(1);expect((await store.list('',0,50,{entryId:entry.id,revisionId:entry.revisionId})).total).toBe(0);expect((await store.list('',0,50,{entryId:entry.id,revisionId:request.revisionId})).total).toBe(1);expect((await store.locate(saved.bookmark.id)).revisionId).toBe(request.revisionId);await expect(store.create({...request,operationId:randomUUID()})).rejects.toMatchObject({code:'bookmark_readonly'});
 const current=join(library.dir,'entries',entry.id,await readFile(join(library.dir,'entries',entry.id,'CURRENT'),'utf8')),payload=JSON.parse(await readFile(current,'utf8'));payload.history=[];await writeFile(current,JSON.stringify(payload));
 await expect(store.locate(saved.bookmark.id)).rejects.toMatchObject({code:'bookmark_location_missing'});expect((await store.list()).bookmarks[0].excerpt).toBe('版本原句');
});

it('retains translated excerpt identity and maps to original paragraph only for the exact translation version',async()=>{
 const s=await setup(),{webWorkspace}=await import('../src/test-support/web'),{buildTranslationSource,translationModelConfig}=await import('../src/lib/web-translation');let w=webWorkspace();if(w.document.kind!=='web')throw Error();w.document={...w.document,markdown:'# English heading\n\nKeep original paragraph for the reader.',web:{...w.document.web,media:[],fragments:[]}};
 if(w.document.kind!=='web')throw Error();const source=buildTranslationSource(w.document.markdown,w.document.web),units=Object.fromEntries(source.units.map(u=>[u.id,u.text.includes('Keep original')?'为读者保留原文段落。':'英文标题']));w={...w,webTranslation:{version:2,id:'translation-safe',target:'zh',documentId:w.document.id,sourceVersion:w.document.web.contentVersion,status:'complete',modelConfig:translationModelConfig(),units,updatedAt:new Date().toISOString()}};
 const entry=await s.library.addWeb(w,new Map(),randomUUID()),[blockId,original]=[...bookmarkSourceBlocks(entry.workspace)].find(([,t])=>t.includes('Keep original'))!,translated=bookmarkSourceBlocks(entry.workspace,true).get(blockId)!,quote='保留原文段落',start=translated.indexOf(quote),a=createAnchor({documentId:w.document.id,blockId,blockText:original,start:0,end:original.length})!;
 a.translation={version:2,translationId:'translation-safe',sourceVersion:w.document.kind==='web'?w.document.web.contentVersion:'',blockId,quote,prefix:translated.slice(0,start),suffix:translated.slice(start+quote.length),start,end:start+quote.length};
 const input={entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor:a},saved=await s.store.create(input);expect(saved.bookmark.excerpt).toBe(quote);expect(saved.bookmark.anchor.quote).toBe(original);expect((await s.store.locate(saved.bookmark.id)).bookmark.anchor.translation?.quote).toBe(quote);
 await expect(s.store.create({...input,operationId:randomUUID(),anchor:{...a,translation:{...a.translation,translationId:'stale'}}})).rejects.toMatchObject({code:'bookmark_translation_mismatch'});
 const fresh=await s.library.get(entry.id);await s.library.save(entry.id,fresh.version,fresh.revisionId,{...fresh.workspace,webTranslation:{...fresh.workspace.webTranslation!,id:'new-translation'}},{ratio:0});await expect(s.store.locate(saved.bookmark.id)).rejects.toMatchObject({code:'bookmark_translation_mismatch'});expect((await s.store.list()).bookmarks[0].excerpt).toBe(quote);
});

it('validates native and existing OCR prefix/suffix from authorized PDF text, rejecting invented searchable context',async()=>{
 const s=await setup(),candidate=await s.library.uploadPdf('safe.pdf',pdfFixture()),entry=await s.library.add(candidate.workspace!,randomUUID(),candidate.selectionId);
 const native:Anchor={documentId:entry.workspace.document.id,blockId:'pdf-1-native',quote:'CHART',prefix:'SYNTHETIC ',suffix:' 1',headingPath:['第1页'],start:0,end:5,matchStatus:'matched',pdf:{kind:'text',source:'native',fileHash:entry.workspace.document.contentHash,page:1,rects:[[70,245,280,270]]}};
 const request=(anchor:Anchor)=>({entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor});
 expect((await s.store.create(request(native))).bookmark.contextBefore).toBe('SYNTHETIC ');
 await expect(s.store.create(request({...native,prefix:'NEVER_IN_THE_PDF',suffix:'MADE_UP_CONTEXT'}))).rejects.toMatchObject({code:'bookmark_anchor_mismatch'});
 const empty={...native,quote:'SYNTHETIC CHART 1',prefix:'',suffix:'',start:0,end:17};expect((await s.store.create(request(empty))).created).toBe(true);
 const ocr=await s.library.resources.ocr(entry.id,{version:1,fileHash:entry.workspace.document.contentHash,page:1,lines:[{text:'本机保存成功',block:'safe-line',rect:[70,80,160,100]}]});
 const a:Anchor={...native,blockId:'pdf-1-ocr-safe',quote:'保存',prefix:'本机',suffix:'成功',start:0,end:2,pdf:{kind:'text',source:'ocr',fileHash:entry.workspace.document.contentHash,page:1,rects:[[70,80,160,100]],ocrId:ocr.id,originalText:'保存'}};
 expect((await s.store.create(request(a))).bookmark.contextAfter).toBe('成功');
 await expect(s.store.create(request({...a,prefix:'INVENTED_OCR_CONTEXT'}))).rejects.toMatchObject({code:'bookmark_anchor_mismatch'});
 expect((await s.store.create(request({...a,prefix:'',suffix:'',start:0,end:2,pdf:{...a.pdf!,rects:[[71,80,160,100]]}}))).created).toBe(true);
 expect((await s.store.list('NEVER_IN_THE_PDF')).total).toBe(0);expect((await s.store.list('INVENTED_OCR_CONTEXT')).total).toBe(0);
});
it('rejects a forged continuous range that skips unsupported visible source text',async()=>{
 const s=await setup('<p>FIRST</p><div>DO NOT OMIT THIS</div><p>LAST</p>');
 const first=s.make('FIRST').anchor,last=s.make('LAST').anchor;
 const {combineBookmarkAnchors}=await import('../src/lib/bookmark-types');
 await expect(s.store.create({...s.make('FIRST'),anchor:combineBookmarkAnchors([first,last])})).rejects.toMatchObject({code:'bookmark_anchor_mismatch'});expect((await s.store.list()).total).toBe(0);
});
