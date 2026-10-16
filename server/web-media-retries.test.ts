// @vitest-environment node
import {it,expect,afterEach,vi} from 'vitest';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';import {PNG} from 'pngjs';
import {WebMediaRetries} from './web-media-retries';import {ReadingLibrary} from './reading-library';import {webFixture} from './test-support/web-fixture';import {WebError,fetchWeb} from './web-fetch';import {createAnchor} from '../src/lib/anchors';import {bookmarkSourceBlocks} from './bookmark-source';
const dirs:string[]=[];afterEach(async()=>{vi.restoreAllMocks();await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const bytes=PNG.sync.write(new PNG({width:12,height:7})),signal=()=>AbortSignal.timeout(2000);
async function setup(){const dir=await mkdtemp(join(tmpdir(),'got-it-media-retry-'));dirs.push(dir);const library=new ReadingLibrary(dir),fixture=await webFixture(true),entry=await library.addWeb(fixture.workspace,fixture.resources,randomUUID());if(entry.workspace.document.kind!=='web')throw Error();return{library,entry,media:entry.workspace.document.web.media[0]};}
it('recovers one image to durable local bytes without changing source identity, and old authorized drafts cannot roll it back',async()=>{
 const s=await setup(),before=s.entry.workspace.document,fetcher=vi.fn<typeof fetchWeb>(async url=>({url,type:'image/png',bytes}));
 const retry=new WebMediaRetries(s.library,fetcher),updated=await retry.retry(s.entry.id,s.entry.revisionId,s.media.id,signal());expect(fetcher).toHaveBeenCalledTimes(1);expect(updated.version).toBe(s.entry.version+1);expect(updated.revisionId).toBe(s.entry.revisionId);
 expect(updated.workspace.document).toMatchObject({id:before.id,markdown:before.markdown,contentHash:before.contentHash});if(updated.workspace.document.kind!=='web')throw Error();expect(updated.workspace.document.web.contentVersion).toBe(before.kind==='web'?before.web.contentVersion:'');
 const media=updated.workspace.document.web.media[0];expect(media).toMatchObject({status:'saved',mime:'image/png',width:12,height:7});expect((await new ReadingLibrary(s.library.dir).readWebResource(updated.id,updated.revisionId,media.resourceId!)).bytes).toEqual(bytes);
 // Current version with a previous authorized media graph is possible after an autosave rebase.
 const staleDraft={...s.entry.workspace,hasUnexportedChanges:true};const saved=await s.library.save(updated.id,updated.version,updated.revisionId,staleDraft,{ratio:.42});
 expect(saved.position.ratio).toBe(.42);expect(saved.workspace.document.kind==='web'&&saved.workspace.document.web.media[0].status).toBe('saved');
 await retry.retry(updated.id,updated.revisionId,s.media.id,signal());expect(fetcher).toHaveBeenCalledTimes(1);
});
it('merges with reading work saved while download is pending and deduplicates the same image task',async()=>{
 const s=await setup();let release!:(value:{url:string;type:string;bytes:Buffer})=>void,started!:()=>void;const begun=new Promise<void>(r=>started=r),pending=new Promise<{url:string;type:string;bytes:Buffer}>(r=>release=r);
 const fetcher=vi.fn<typeof fetchWeb>(async()=>{started();return pending;}),retry=new WebMediaRetries(s.library,fetcher);const first=retry.retry(s.entry.id,s.entry.revisionId,s.media.id,signal()),second=retry.retry(s.entry.id,s.entry.revisionId,s.media.id,signal());await begun;
 const [blockId,text]=[...bookmarkSourceBlocks(s.entry.workspace)].find(([,t])=>t.includes('useful readable'))!,anchor=createAnchor({documentId:s.entry.workspace.document.id,blockId,blockText:text,start:0,end:10})!;
 const w={...s.entry.workspace,inquiries:[{id:'safe-new-note',intent:'explain' as const,question:'解释',anchor,status:'ready' as const,messages:[],understanding:'期间写下的新理解',createdAt:'2026-10-15',updatedAt:'2026-10-15'}]};
 await s.library.save(s.entry.id,s.entry.version,s.entry.revisionId,w,{ratio:.6});release({url:s.media.sourceUrl!,type:'image/png',bytes});const [a,b]=await Promise.all([first,second]);expect(a.version).toBe(3);expect(b.version).toBe(3);expect(fetcher).toHaveBeenCalledTimes(1);expect(a.workspace.inquiries[0].understanding).toBe('期间写下的新理解');expect(a.position.ratio).toBe(.6);
});
it('keeps failures retryable, rejects false MIME, and does not promote canceled downloads',async()=>{
 const s=await setup(),before=await readFile(join(s.library.dir,'entries',s.entry.id,'CURRENT'),'utf8');let attempt=0;
 const retry=new WebMediaRetries(s.library,async url=>{attempt++;if(attempt===1)throw new WebError('controlled unavailable','web_unavailable',502);return{url,type:attempt===2?'image/jpeg':'image/png',bytes};});
 await expect(retry.retry(s.entry.id,s.entry.revisionId,s.media.id,signal())).rejects.toMatchObject({code:'web_unavailable'});await expect(retry.retry(s.entry.id,s.entry.revisionId,s.media.id,signal())).rejects.toMatchObject({code:'web_image'});expect(await readFile(join(s.library.dir,'entries',s.entry.id,'CURRENT'),'utf8')).toBe(before);
 const controller=new AbortController(),canceled=new WebMediaRetries(s.library,async url=>{controller.abort();return{url,type:'image/png',bytes};});await expect(canceled.retry(s.entry.id,s.entry.revisionId,s.media.id,controller.signal)).rejects.toThrow();expect((await s.library.get(s.entry.id)).version).toBe(1);
 expect((await retry.retry(s.entry.id,s.entry.revisionId,s.media.id,signal())).version).toBe(2);expect(attempt).toBe(3);
});
it('rejects historical, unknown, no-URL or unsupported targets before network activity',async()=>{
 const s=await setup(),fetcher=vi.fn<typeof fetchWeb>(),retry=new WebMediaRetries(s.library,fetcher);
 await expect(retry.retry(s.entry.id,randomUUID(),s.media.id,signal())).rejects.toMatchObject({code:'web_media_revision'});await expect(retry.retry(s.entry.id,s.entry.revisionId,'unknown',signal())).rejects.toMatchObject({code:'web_media_unavailable'});
 const old=await webFixture(true);if(old.workspace.document.kind!=='web')throw Error();delete old.workspace.document.web.media[0].sourceUrl;old.workspace.document.web.originalUrl='https://old.example/story';old.workspace.document.web.finalUrl='https://old.example/story';const entry=await s.library.addWeb(old.workspace,old.resources,randomUUID());
 await expect(retry.retry(entry.id,entry.revisionId,old.workspace.document.web.media[0].id,signal())).rejects.toMatchObject({code:'web_media_unavailable'});expect(fetcher).not.toHaveBeenCalled();
});
it('leaves the missing snapshot untouched on durable resource write failure',async()=>{
 const s=await setup(),retry=new WebMediaRetries(s.library,async url=>({url,type:'image/png',bytes}));vi.spyOn(s.library.webResources,'put').mockRejectedValueOnce(new Error('controlled ENOSPC'));
 await expect(retry.retry(s.entry.id,s.entry.revisionId,s.media.id,signal())).rejects.toThrow('ENOSPC');const current=await s.library.get(s.entry.id);expect(current.version).toBe(1);expect(current.workspace.document.kind==='web'&&current.workspace.document.web.media[0].status).toBe('missing');
 expect((await retry.retry(s.entry.id,s.entry.revisionId,s.media.id,signal())).version).toBe(2);
});
it('recovers existing X public missing media with the original pbs policy, refusing a redirect outside that policy',async()=>{
 const s=await setup(),fixture=await webFixture(true);if(fixture.workspace.document.kind!=='web')throw Error();const doc=fixture.workspace.document;doc.web={...doc.web,originalUrl:'https://x.com/i/status/123',finalUrl:'https://x.com/i/status/123',extractorVersion:'x-fxtwitter-public-v1',retrieval:{kind:'public-service',provider:'fxtwitter',url:'https://api.fxtwitter.com/2/status/123'},media:doc.web.media.map(m=>({...m,sourceUrl:'https://pbs.twimg.com/media/SafeFixture.png'}))};const entry=await s.library.addWeb(fixture.workspace,fixture.resources,randomUUID()),id=doc.web.media[0].id;
 const blocked=new WebMediaRetries(s.library,async(_url,options)=>{options.validateUrl!('https://other.example/media.png');throw Error('unreachable');});await expect(blocked.retry(entry.id,entry.revisionId,id,signal())).rejects.toMatchObject({code:'web_resource_host'});
 const fetcher=vi.fn<typeof fetchWeb>(async(url,options)=>{options.validateUrl!(url);return{url,type:'image/png',bytes};}),updated=await new WebMediaRetries(s.library,fetcher).retry(entry.id,entry.revisionId,id,signal());expect(fetcher.mock.calls[0][0]).toBe('https://pbs.twimg.com/media/SafeFixture.png');expect(updated.revisionId).toBe(entry.revisionId);expect(updated.workspace.document.contentHash).toBe(entry.workspace.document.contentHash);
});
it('recovers just the requested image even if another previously saved local object is missing',async()=>{
 const s=await setup(),fixture=await webFixture(false);if(fixture.workspace.document.kind!=='web')throw Error();const doc=fixture.workspace.document,other=doc.web.media[0],target={id:randomUUID(),kind:'image' as const,status:'missing' as const,alt:'Second image',reason:'controlled missing',sourceUrl:'https://public.example/second.png'};doc.web.originalUrl='https://separate.example/multiple';doc.web.finalUrl=doc.web.originalUrl;doc.web.media.push(target);doc.markdown+='\n![Second image](got-it-media:'+target.id+')\n';
 const entry=await s.library.addWeb(fixture.workspace,fixture.resources,randomUUID());await rm(join(s.library.dir,'web-resources','objects',other.resourceId+'.bin'));
 const result=await new WebMediaRetries(s.library,async url=>({url,type:'image/png',bytes})).retry(entry.id,entry.revisionId,target.id,signal());expect(result.workspace.document.kind==='web'&&result.workspace.document.web.media.find(m=>m.id===target.id)?.status).toBe('saved');await expect(s.library.readWebResource(entry.id,entry.revisionId,other.resourceId!)).rejects.toMatchObject({code:'web_resource_missing'});
});
