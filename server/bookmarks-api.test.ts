// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import type {Server} from 'node:http';
import {createApp} from './index';import {ReadingLibrary} from './reading-library';import {readDocumentFile} from '../src/lib/reading-document-core';import {bookmarkSourceBlocks} from './bookmark-source';import {createAnchor} from '../src/lib/anchors';import type {ProviderService} from './providers';
let server:Server|undefined,dir='';afterEach(async()=>{await new Promise<void>(r=>server?server.close(()=>r()):r());if(dir)await rm(dir,{recursive:true,force:true});});
it('guards every bookmark route, validates registered source ranges and never invokes providers',async()=>{
 dir=await mkdtemp(join(tmpdir(),'got-it-bookmark-api-'));const library=new ReadingLibrary(dir),answer=vi.fn(()=>{throw Error('must not call AI');}),providerService={answer,translateWebBatch:answer} as unknown as ProviderService,app=createApp({library,providerService});server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/library`;
 expect((await fetch(base+'/bookmarks')).status).toBe(401);expect((await fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'})).status).toBe(403);
 const {token}=await(await fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json(),headers={'Content-Type':'application/json','X-Got-It-Session':token};
 const workspace=await readDocumentFile({name:'Safe.md',size:10,text:async()=>'# 安全\n\n仅保存这一处原文。'}),entry=await library.add(workspace,crypto.randomUUID()),[blockId,text]=[...bookmarkSourceBlocks(workspace)].find(([,t])=>t.includes('仅保存'))!,anchor=createAnchor({documentId:workspace.document.id,blockId,blockText:text,start:0,end:5})!,body={operationId:crypto.randomUUID(),entryId:entry.id,revisionId:entry.revisionId,anchor,sourcePath:'/private/UNTRUSTED_PATH',apiKey:'UNTRUSTED_SECRET'};
 expect((await fetch(base+'/bookmarks',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(body)})).status).toBe(403);
 const created=await fetch(base+'/bookmarks',{method:'POST',headers,body:JSON.stringify(body)});expect(created.status).toBe(200);const result=await created.json();expect(result.created).toBe(true);
 const lostResponseRetry=await(await fetch(base+'/bookmarks',{method:'POST',headers,body:JSON.stringify(body)})).json();expect(lostResponseRetry.bookmark.id).toBe(result.bookmark.id);
 const list=await(await fetch(base+'/bookmarks?q='+encodeURIComponent('仅保存'),{headers})).json();expect(list.total).toBe(1);
 const scoped=async (query:string)=>(await fetch(base+'/bookmarks?'+query,{headers}));
 expect((await(await scoped('entryId='+entry.id)).json()).total).toBe(1);
 expect((await(await scoped('entryId='+crypto.randomUUID())).json()).total).toBe(0);
 expect((await(await scoped('entryId='+entry.id+'&revisionId='+entry.revisionId)).json()).total).toBe(1);
 expect((await(await scoped('entryId='+entry.id+'&revisionId='+crypto.randomUUID())).json()).total).toBe(0);
 expect((await scoped('entryId=..%2Fprivate')).status).toBe(400);
 expect(JSON.stringify(list)).not.toMatch(/UNTRUSTED_PATH|UNTRUSTED_SECRET/);
 expect((await fetch(base+'/bookmarks/'+result.bookmark.id+'/location',{headers})).status).toBe(200);
 expect((await fetch(base+'/bookmarks',{method:'POST',headers,body:JSON.stringify({...body,operationId:crypto.randomUUID(),entryId:crypto.randomUUID()})})).status).toBe(404);
 const removed=await fetch(base+'/bookmarks/'+result.bookmark.id+'/delete',{method:'POST',headers,body:JSON.stringify({expectedVersion:1,creationOperationId:body.operationId})});expect(removed.status).toBe(200);expect((await(await fetch(base+'/bookmarks',{headers})).json()).total).toBe(0);expect(answer).not.toHaveBeenCalled();
});
