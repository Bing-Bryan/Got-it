// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ReadingLibrary} from './reading-library';import {PdfOutlineStore} from './pdf-outline';import {pdfFixture} from './test-support/pdf-fixture';
let dir='';afterEach(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
it('persists outlines independently, checks file identity and serializes competing writes',async()=>{
 dir=await mkdtemp(join(tmpdir(),'got-it-outline-'));const l=new ReadingLibrary(dir);const c=await l.uploadPdf('safe.pdf',pdfFixture(2));const e=await l.add(c.workspace,'outline-test',c.selectionId);const hash=e.workspace.document.contentHash;
 const store=new PdfOutlineStore(l),empty=await store.get(e.id,hash);expect(empty.items).toEqual([]);
 const value={...empty,items:[{id:'section',title:'First chapter',page:2,top:.1,level:1 as const,source:'manual' as const}]};
 const results=await Promise.allSettled([store.save(e.id,hash,value),store.save(e.id,hash,value)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 expect((await new PdfOutlineStore(new ReadingLibrary(dir)).get(e.id,hash)).items[0].title).toBe('First chapter');
 expect((await l.get(e.id)).workspace).toEqual(e.workspace);
 await expect(store.get(e.id,'f'.repeat(64))).rejects.toMatchObject({status:409});
 await expect(store.save(e.id,hash,{...value,revision:1,items:[{...value.items[0],page:3}]})).rejects.toMatchObject({status:400});
 // Normal reading saves must not garbage-collect the separate outline directory.
 await l.save(e.id,e.version,e.revisionId,e.workspace,e.position);expect((await store.get(e.id,hash)).items).toHaveLength(1);
});
it('protects outline endpoints with session and origin checks',async()=>{
 const {createApp}=await import('./index');dir=await mkdtemp(join(tmpdir(),'got-it-outline-api-'));const l=new ReadingLibrary(dir);const c=await l.uploadPdf('safe.pdf',pdfFixture());const e=await l.add(c.workspace,'outline-api',c.selectionId);
 const server=createApp({library:l}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/library`,path=`/entries/${e.id}/outline/${e.workspace.document.contentHash}`;
 expect((await fetch(base+path)).status).toBe(401);
 const {token}=await(await fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();const headers={'X-Got-It-Session':token,'Content-Type':'application/json'};
 const empty=await(await fetch(base+path,{headers})).json();expect(empty.revision).toBe(0);
 expect((await fetch(base+path,{method:'POST',headers:{...headers,Origin:'https://example.com'},body:JSON.stringify(empty)})).status).toBe(403);
 expect((await fetch(base+path,{method:'POST',headers,body:JSON.stringify({...empty,items:[{id:'x',title:'Header',page:1,top:0,level:1,source:'manual'}]})})).status).toBe(200);
 expect((await(await fetch(base+path,{headers})).json()).items[0].title).toBe('Header');
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
