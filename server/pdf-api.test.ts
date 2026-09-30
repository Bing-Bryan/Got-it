// @vitest-environment node
import {afterEach,expect,it} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import type {Server} from 'node:http';
import {createApp} from './index';import {ReadingLibrary} from './reading-library';import {pdfFixture} from './test-support/pdf-fixture';import {PNG} from 'pngjs';
let server:Server|undefined,dir='';afterEach(async()=>{await new Promise<void>(r=>server?server.close(()=>r()):r());if(dir)await rm(dir,{recursive:true,force:true});});
it('requires same-origin session for binary resources and image requests, rejects cross-entry/path/URL references',async()=>{
 dir=await mkdtemp(join(tmpdir(),'got-it-pdf-api-'));const app=createApp({library:new ReadingLibrary(dir)});server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));const base=`http://127.0.0.1:${(server.address()as {port:number}).port}`;
 const {token}=await(await fetch(base+'/api/library/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
 const headers={'X-Got-It-Session':token,'Content-Type':'application/pdf'};
 expect((await fetch(base+'/api/library/pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:new Uint8Array(pdfFixture())})).status).toBe(401);
 expect((await fetch(base+'/api/library/pdf',{method:'POST',headers:{...headers,Origin:'https://hostile.example'},body:new Uint8Array(pdfFixture())})).status).toBe(403);
 const candidate=await(await fetch(base+'/api/library/pdf?filename=sample.pdf',{method:'POST',headers,body:new Uint8Array(pdfFixture())})).json();
 const jsonHeaders={...headers,'Content-Type':'application/json'};
 const entry=await(await fetch(base+'/api/library/entries',{method:'POST',headers:jsonHeaders,body:JSON.stringify({workspace:candidate.workspace,creationKey:'api',selectionId:candidate.selectionId})})).json();expect(entry.id).toBeTruthy();
 const id=entry.workspace.document.contentHash,path=`/api/library/entries/${entry.id}`;
 const read=await fetch(base+path+'/resources/'+id,{headers});expect(read.status).toBe(200);expect(Buffer.from(await read.arrayBuffer())).toEqual(pdfFixture());
 expect((await fetch(base+`/api/library/entries/${crypto.randomUUID()}/resources/${id}`,{headers})).status).toBe(400);
 const query=new URLSearchParams({fileHash:id,page:'1',rect:'[70,60,300,200]'});
 const valid=await fetch(base+path+'/crops?'+query,{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:new Uint8Array(PNG.sync.write(new PNG({width:16,height:16})))});expect(valid.status).toBe(200);const crop=await valid.json();
 const req={providerId:'codex',intent:'explain',quote:'region',question:'explain',context:'',history:[],image:{entryId:entry.id,fileHash:id,cropId:crop.id}};
 const noSession=await fetch(base+'/api/inquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)});expect(noSession.status).toBe(401);
 const bad=await fetch(base+'/api/inquiries',{method:'POST',headers:jsonHeaders,body:JSON.stringify({...req,image:{...req.image,cropId:id}})});expect(bad.status).toBe(400);
 const url=await fetch(base+'/api/inquiries',{method:'POST',headers:jsonHeaders,body:JSON.stringify({...req,image:{url:'file:///private/secret'}})});expect(url.status).toBe(400);
});
