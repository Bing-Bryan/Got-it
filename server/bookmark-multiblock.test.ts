import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID,createHash} from 'node:crypto';
import {ReadingLibrary} from './reading-library';import {Bookmarks} from './bookmarks';import {bookmarkSourceBlocks} from './bookmark-source';
import {readDocumentFile} from '../src/lib/reading-document-core';import {renderMarkdown} from '../src/lib/markdown';import {createAnchor} from '../src/lib/anchors';import {combineBookmarkAnchors} from '../src/lib/bookmark-types';import type {Anchor} from '../src/types';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
async function setup(){
 const markdown='# 起点标题\n\n首段，保留开头与结尾。\n\n- 第一个列表项\n  - 嵌套子项不可遗漏\n- 第二个列表项\n\n末段，到此结束。';
 const dir=await mkdtemp(join(tmpdir(),'got-it-multiblock-'));dirs.push(dir);const library=new ReadingLibrary(join(dir,'data'));
 const workspace=await readDocumentFile({name:'safe-multiple.md',size:Buffer.byteLength(markdown),text:async()=>markdown});const entry=await library.add(workspace,randomUUID());
 const container=document.createElement('article');container.innerHTML=renderMarkdown(markdown).html;
 // Derive IDs/text from actual sanitized reader DOM, not the server parser under test.
 const roots=[...container.querySelectorAll<HTMLElement>('[data-block-id]')].filter(n=>!n.parentElement?.closest('[data-block-id]'));
 const segments=roots.map(n=>createAnchor({documentId:workspace.document.id,blockId:n.dataset.blockId!,blockText:n.textContent!,start:0,end:n.textContent!.length})!);
 const store=new Bookmarks(library),request=(parts:Anchor[])=>({entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor:combineBookmarkAnchors(parts)});
 return{dir,library,workspace,entry,store,roots,segments,request};
}
it('persists a real DOM continuous title/paragraph/nested-list range completely, locates every segment and preserves legacy records',async()=>{
 const s=await setup();expect([...bookmarkSourceBlocks(s.workspace,false,true).keys()]).toEqual(s.roots.map(n=>n.dataset.blockId));
 const parts=s.segments.map(a=>({...a}));const first=parts[0],last=parts.at(-1)!;first.start=1;first.quote=first.quote.slice(1);first.prefix='起';last.end-=2;last.quote=last.quote.slice(0,-2);last.suffix='束。';
 const input=s.request(parts),saved=await s.store.create(input);expect(saved.bookmark.excerpt).toBe(parts.map(a=>a.quote).join('\n'));expect(saved.bookmark.excerpt).toContain('嵌套子项不可遗漏');
 expect(saved.bookmark.contextBefore).toBe('起');expect(saved.bookmark.contextAfter).toBe('束。');
 const reopened=new Bookmarks(new ReadingLibrary(s.library.dir));expect((await reopened.locate(saved.bookmark.id)).bookmark.anchor.segments).toEqual(parts);expect((await reopened.list('嵌套子项')).total).toBe(1);
 const legacy=await reopened.create(s.request([s.segments[1]]));expect(legacy.bookmark.anchor.segments).toBeUndefined();expect((await new Bookmarks(s.library).list()).total).toBe(2);
});
it('rejects missing, reordered, repeated, shortened-middle and forged ranges without writing any receipt',async()=>{
 const s=await setup(),base=s.segments;
 const shortened={...base[1],end:base[1].end-1,quote:base[1].quote.slice(0,-1),suffix:base[1].quote.slice(-1)};
 const forged={...base[1],quote:'假'.repeat(base[1].quote.length)};
 const invalid=[s.request([base[0],base[2]]),s.request([base[1],base[0]]),s.request([base[0],base[0]]),s.request([base[0],shortened,base[2]]),s.request([base[0],forged,base[2]]),s.request([{...base[0],documentId:'other'},base[1]])];
 const altered=s.request(base);altered.anchor={...altered.anchor,quote:altered.anchor.quote.replace('首段','伪造')};invalid.push(altered);
 for(const request of invalid)await expect(s.store.create(request)).rejects.toMatchObject({status:expect.any(Number)});
 expect((await s.store.list()).total).toBe(0);await expect(readFile(s.store.file,'utf8')).rejects.toMatchObject({code:'ENOENT'});
});
it('deduplicates the complete range across tabs, keeps distinct endpoints separate, and prevents deleted retries reviving it',async()=>{
 const s=await setup(),input=s.request(s.segments),duplicate={...input,operationId:randomUUID()};
 const [a,b]=await Promise.all([s.store.create(input),new Bookmarks(s.library).create(duplicate)]);expect(a.bookmark.id).toBe(b.bookmark.id);expect(b.created).toBe(false);
 const last=s.segments.at(-1)!,shorter={...last,end:last.end-1,quote:last.quote.slice(0,-1),suffix:last.quote.slice(-1)};
 expect((await s.store.create(s.request([...s.segments.slice(0,-1),shorter]))).bookmark.id).not.toBe(a.bookmark.id);
 await s.store.remove(a.bookmark.id,1,input.operationId);await expect(s.store.create(duplicate)).rejects.toMatchObject({code:'bookmark_deleted'});expect((await s.store.list()).total).toBe(1);
});
it('preserves translated multi-block identity and rejects mixed reading sides or stale translation mappings',async()=>{
 const s=await setup(),{webWorkspace}=await import('../src/test-support/web'),{buildTranslationSource,renderTranslatedHtml,translationModelConfig}=await import('../src/lib/web-translation');
 let workspace=webWorkspace();if(workspace.document.kind!=='web')throw Error();workspace.document={...workspace.document,markdown:'# Heading\n\nFirst paragraph.\n\nSecond paragraph.',web:{...workspace.document.web,media:[],fragments:[]}};
 const doc=workspace.document;if(doc.kind!=='web')throw Error();const source=buildTranslationSource(doc.markdown,doc.web),units=Object.fromEntries(source.units.map(u=>[u.id,'译文'+u.text]));
 workspace={...workspace,webTranslation:{version:2,id:'continuous-translation',target:'zh',documentId:doc.id,sourceVersion:doc.web.contentVersion,status:'complete',modelConfig:translationModelConfig(),units,updatedAt:new Date().toISOString()}};
 const entry=await s.library.addWeb(workspace,new Map(),randomUUID()),original=document.createElement('article'),translated=document.createElement('article');original.innerHTML=source.html;translated.innerHTML=renderTranslatedHtml(source,units);
 const segments=[...original.querySelectorAll<HTMLElement>('[data-block-id]')].filter(n=>!n.parentElement?.closest('[data-block-id]')).map(n=>{
  const blockId=n.dataset.blockId!,text=n.textContent!,a=createAnchor({documentId:doc.id,blockId,blockText:text,start:0,end:text.length})!;
  const t=translated.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`)!.textContent!;return{...a,translation:{version:2 as const,translationId:'continuous-translation',sourceVersion:doc.web.contentVersion,blockId,quote:t,prefix:'',suffix:'',start:0,end:t.length}};
 });
 const request={entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor:combineBookmarkAnchors(segments)},saved=await s.store.create(request);
 expect(saved.bookmark.excerpt).toBe(segments.map(a=>a.translation.quote).join('\n'));expect(saved.bookmark.anchor.quote).toBe(segments.map(a=>a.quote).join('\n'));expect((await s.store.locate(saved.bookmark.id)).bookmark.id).toBe(saved.bookmark.id);
 const mixed=segments.map((a,i)=>i?{...a,translation:undefined}:a);await expect(s.store.create({...request,operationId:randomUUID(),anchor:combineBookmarkAnchors(mixed)})).rejects.toMatchObject({status:400});
 const stale=segments.map((a,i)=>i?{...a,translation:{...a.translation,translationId:'stale'}}:a);await expect(s.store.create({...request,operationId:randomUUID(),anchor:combineBookmarkAnchors(stale)})).rejects.toMatchObject({code:'bookmark_translation_mismatch'});
});

it('retries a persisted pre-segments operation receipt without changing its position identity',async()=>{
 const s=await setup(),input=s.request([s.segments[1]]),saved=await s.store.create(input),a=input.anchor;
 // Exact eight-field layout written by a4a2ec9, before the optional segments extension.
 const oldPosition=JSON.stringify([input.entryId,input.revisionId,a.documentId,a.blockId,a.start,a.end,null,null]);
 const database=JSON.parse(await readFile(s.store.file,'utf8'));database.operations[input.operationId].position=createHash('sha256').update(oldPosition).digest('hex');await writeFile(s.store.file,JSON.stringify(database));
 expect((await new Bookmarks(s.library).create(input)).bookmark.id).toBe(saved.bookmark.id);expect((await s.store.list()).total).toBe(1);
});
it('keeps safe HTML div/span text complete using real bookmark-only DOM identities',async()=>{
 const s=await setup();const markdown='<p>FIRST</p><div>DO NOT OMIT <span>THIS</span></div><p>LAST</p>';
 const workspace=await readDocumentFile({name:'safe-html.md',size:markdown.length,text:async()=>markdown}),entry=await s.library.add(workspace,randomUUID());
 const article=document.createElement('article');article.innerHTML=renderMarkdown(markdown).html;
 const {bookmarkRootElements,bookmarkElementId}=await import('../src/lib/bookmark-dom');const {bookmarkSourceRoots}=await import('./bookmark-source');
 const roots=bookmarkRootElements(article),parts=roots.map(root=>createAnchor({documentId:workspace.document.id,blockId:bookmarkElementId(root),blockText:root.textContent!,start:0,end:root.textContent!.length})!);
 expect([...bookmarkSourceRoots(workspace).keys()]).toEqual(parts.map(part=>part.blockId));
 const input={entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor:combineBookmarkAnchors(parts)};const saved=await s.store.create(input);expect(saved.bookmark.excerpt).toBe('FIRST\nDO NOT OMIT THIS\nLAST');expect((await s.store.locate(saved.bookmark.id)).bookmark.anchor.segments).toHaveLength(3);
 await expect(s.store.create({...input,operationId:randomUUID(),anchor:combineBookmarkAnchors([parts[0],parts[2]])})).rejects.toMatchObject({code:'bookmark_anchor_mismatch'});
});
it('deduplicates a legacy paragraph after reselecting it inside a new supplemental HTML root',async()=>{
 const s=await setup(),markdown='<div>bare<p>KEEP THIS</p></div>',workspace=await readDocumentFile({name:'safe-legacy-nested.md',size:markdown.length,text:async()=>markdown}),entry=await s.library.add(workspace,randomUUID());
 const article=document.createElement('article');article.innerHTML=renderMarkdown(markdown).html;document.body.append(article);const p=article.querySelector('p')!,range=document.createRange();range.selectNodeContents(p);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 const {createAnchorFromSelection}=await import('../src/lib/anchors'),{createBookmarkDraft}=await import('../src/lib/bookmark-selection');const legacy=createAnchorFromSelection(selection,article,workspace.document.id);if('error'in legacy)throw Error(legacy.error);
 const input={entryId:entry.id,revisionId:entry.revisionId,operationId:randomUUID(),anchor:legacy.anchor},original=await s.store.create(input),current=createBookmarkDraft(selection,article,workspace);if('error'in current)throw Error(current.error);
 const duplicate=await s.store.create({...input,operationId:randomUUID(),anchor:current.anchor});expect(duplicate.created).toBe(false);expect(duplicate.bookmark.id).toBe(original.bookmark.id);expect((await s.store.list()).total).toBe(1);selection.removeAllRanges();article.remove();
});
