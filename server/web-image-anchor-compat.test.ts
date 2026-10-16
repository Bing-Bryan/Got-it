import {afterEach,expect,it} from 'vitest';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID,createHash} from 'node:crypto';import {PNG} from 'pngjs';
import oldFixture from './test-support/web-image-legacy-dom.json';import {createInitialWorkspace} from '../src/sample';import {ReadingLibrary} from './reading-library';import {Bookmarks} from './bookmarks';import {WebMediaRetries} from './web-media-retries';import {createAnchor} from '../src/lib/anchors';import {combineBookmarkAnchors,bookmarkPosition} from '../src/lib/bookmark-types';import {renderMarkdown} from '../src/lib/markdown';import {buildTranslationSource} from '../src/lib/web-translation';import type {WebDocumentData} from '../src/lib/web-data';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
async function setup(){const dir=await mkdtemp(join(tmpdir(),'got-it-old-image-anchors-'));dirs.push(dir);const library=new ReadingLibrary(dir),workspace=createInitialWorkspace();workspace.document={kind:'web',id:randomUUID(),filename:'Safe old image anchors',markdown:oldFixture.markdown,web:oldFixture.web as WebDocumentData,contentHash:oldFixture.web.contentVersion,importedAt:'2026-10-15',isDemo:false};const entry=await library.addWeb(workspace,new Map(),randomUUID()),store=new Bookmarks(library),old=document.createElement('article');old.innerHTML=oldFixture.html;
 const part=(element:HTMLElement,quote:string)=>createAnchor({documentId:workspace.document.id,blockId:element.dataset.blockId!,blockText:element.textContent!,start:element.textContent!.indexOf(quote),end:element.textContent!.indexOf(quote)+quote.length})!;
 const current=(w:typeof workspace)=>{if(w.document.kind!=='web')throw Error();const article=document.createElement('article');article.innerHTML=renderMarkdown(w.document.markdown,w.document.web).html;return article;};
 const request=(anchor:ReturnType<typeof part>)=>({entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor});
 const retry=()=>new WebMediaRetries(library,async url=>({url,type:'image/png',bytes:PNG.sync.write(new PNG({width:9,height:6}))})).retry(entry.id,entry.revisionId,'legacy-image',AbortSignal.timeout(2000));
 return{dir,library,workspace,entry,store,old,part,current,request,retry};
}
it('keeps old FIRST/LAST table offsets and records valid, without rebinding repeated text or duplicating a post-recovery selection',async()=>{
 const s=await setup(),cell=s.old.querySelector<HTMLElement>('td')!,first=s.part(cell,'FIRST repeated'),last=s.part(cell,'LAST repeated'),firstInput=s.request(first),lastInput=s.request(last);
 // The immutable old HTML contains the complete historic missing-description text.
 expect(cell.textContent).toContain('fixture download unavailable 查看原图');expect(last.start).toBeGreaterThan(40);
 const [a,b]=await Promise.all([s.store.create(firstInput),s.store.create(lastInput)]),before=JSON.parse(await readFile(s.store.file,'utf8')).records;
 const legacyDb=JSON.parse(await readFile(s.store.file,'utf8'));for(const input of [firstInput,lastInput])legacyDb.operations[input.operationId].position=createHash('sha256').update(bookmarkPosition(input)).digest('hex');await writeFile(s.store.file,JSON.stringify(legacyDb));
 const updated=await s.retry(),dom=s.current(updated.workspace),target=dom.querySelector<HTMLElement>(`[data-block-id="${last.blockId}"]`)!;
 expect(target.textContent).toBe('FIRST repeated  LAST repeated');expect(updated.workspace.document.kind==='web'&&updated.workspace.document.web.media[0].legacyMissing).toEqual({reason:'fixture download unavailable',linked:true});
 expect((await s.store.locate(a.bookmark.id)).bookmark.anchor).toEqual(first);expect((await s.store.locate(b.bookmark.id)).bookmark.anchor).toEqual(last);
 const fresh=s.part(target,'LAST repeated'),found=await s.store.lookup(s.request(fresh));expect(found.bookmark?.id).toBe(b.bookmark.id);expect((await s.store.create(s.request(fresh))).created).toBe(false);expect((await s.store.create(lastInput)).bookmark.id).toBe(b.bookmark.id);
 expect(JSON.parse(await readFile(s.store.file,'utf8')).records).toEqual(before);expect((await s.store.list()).total).toBe(2);
 const second=dom.querySelectorAll<HTMLElement>('td')[1],separate=await s.store.create(s.request(s.part(second,'LAST repeated')));expect(separate.bookmark.id).not.toBe(b.bookmark.id);
 await s.store.remove(b.bookmark.id,1,lastInput.operationId);await expect(s.store.create(lastInput)).rejects.toMatchObject({code:'bookmark_deleted'});
});
it('validates an old multi-block LAST-to-following-paragraph range after recovery, retaining exact original quote and segment identity',async()=>{
 const s=await setup(),cell=s.old.querySelector<HTMLElement>('td')!,following=s.old.querySelectorAll<HTMLElement>('td')[1],paragraph=s.old.querySelector<HTMLElement>('p')!;
 const parts=[s.part(cell,'LAST repeated'),s.part(following,following.textContent!),s.part(paragraph,'FIRST repeated')],anchor=combineBookmarkAnchors(parts),input=s.request(anchor),saved=await s.store.create(input);const updated=await s.retry();expect((await s.store.locate(saved.bookmark.id)).bookmark.anchor).toEqual(anchor);
 const current=s.current(updated.workspace),fresh=combineBookmarkAnchors(parts.map(a=>{const element=current.querySelector<HTMLElement>(`[data-block-id="${a.blockId}"]`)!;return s.part(element,a.quote);}));expect((await s.store.create(s.request(fresh))).bookmark.id).toBe(saved.bookmark.id);expect((await s.store.list()).bookmarks[0].excerpt).toBe(anchor.quote);
 const doc=updated.workspace.document;if(doc.kind!=='web')throw Error();expect(buildTranslationSource(doc.markdown,doc.web).units).toEqual(oldFixture.translationUnits);
});
