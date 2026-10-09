// @vitest-environment node
import { afterEach,describe,it,expect,vi } from 'vitest';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { ReadingLibrary } from './reading-library';
import { createApp } from './index';
import { readingFixture,editReading,draftFixture } from '../src/test-support/recovery-fixture';
import type { RecoveryRecord,RecoveryResult } from '../src/lib/reading-recovery';
const dirs:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function setup(){const dir=await mkdtemp(join(tmpdir(),'recovery-test-'));dirs.push(dir);const l=new ReadingLibrary(dir);const e=await l.add(readingFixture(),'fixture');return {l,e,dir};}
function review(result:RecoveryResult):RecoveryRecord {if(result.kind!=='review')throw new Error('expected review');return result.record;}
describe('durable reading recovery',()=>{
 it('cleans equal data, restores view, and asks about edits after metadata version changes',async()=>{
  const {l,e}=await setup();const d=draftFixture(e);await l.activate(e.id);
  const restored=review(await l.recover(e.id,d));expect(restored.state).toBe('pending');
  expect(review(await l.recover(e.id,d)).id).toBe(restored.id);expect(await l.listRecoveries()).toHaveLength(1);
  const latest=await l.get(e.id);const view={...draftFixture(latest),workspace:latest.workspace,position:{ratio:.8}};
  expect((await l.recover(e.id,view)).kind).toBe('same');expect((await l.get(e.id)).position.ratio).toBe(.8);
 });
 it('supports legacy matching versions and conservatively preserves legacy unknown baselines',async()=>{
  const {l,e}=await setup();const d=draftFixture(e);delete d.id;delete d.baseDigest;
  expect((await l.recover(e.id,d)).kind).toBe('review');
  const other={...d,workspace:editReading(d.workspace,'另一个旧缓存')};const r=review(await l.recover(e.id,other));expect(r.reason).toBe('unknown');
  expect(review(await l.recover(e.id,other)).id).toBe(r.id);expect(await l.listRecoveries()).toHaveLength(2);
 });
 it.each(['draft','disk'] as const)('preserves both sides when choosing %s; reads them after restart and ordinary saves',async(choice)=>{
  const {l,e,dir}=await setup();const d=draftFixture(e);const disk=await l.save(e.id,e.version,e.revisionId,editReading(e.workspace,'磁盘新回答'),e.position);
  const r=review(await l.recover(e.id,d));const selected=await l.resolveRecovery(r.id,choice,disk.version);
  expect(selected.entry.workspace.inquiries[0].messages[0].content).toBe(choice==='draft'?'尚未保存的回答':'磁盘新回答');
  const restart=new ReadingLibrary(dir);await restart.save(e.id,selected.entry.version,e.revisionId,editReading(selected.entry.workspace,'后续编辑'),e.position);
  const retained=await restart.getRecovery(r.id);expect(retained.state).toBe('resolved');expect(retained.draft.workspace.inquiries[0].messages[0].content).toBe('尚未保存的回答');expect(retained.disk!.workspace.inquiries[0].messages[0].content).toBe('磁盘新回答');
  expect((await restart.resolveRecovery(r.id,choice,disk.version)).entry.id).toBe(e.id);
 });
 it('rejects stale choices and retains every previously shown disk snapshot',async()=>{
  const {l,e}=await setup();const d=draftFixture(e);let disk=await l.save(e.id,e.version,e.revisionId,editReading(e.workspace,'磁盘一'),e.position);
  const r=review(await l.recover(e.id,d));disk=await l.save(e.id,disk.version,e.revisionId,editReading(e.workspace,'磁盘二'),e.position);
  await expect(l.resolveRecovery(r.id,'draft',r.disk!.version)).rejects.toMatchObject({status:409});
  const fresh=await l.getRecovery(r.id);expect(fresh.previous).toHaveLength(1);expect(fresh.disk!.workspace.inquiries[0].messages[0].content).toBe('磁盘二');
  expect((await l.resolveRecovery(r.id,'draft',disk.version)).record.state).toBe('resolved');
 });
 it('creates an unlinked separate entry for different original revisions or unreadable originals',async()=>{
  const {l,e,dir}=await setup();const d=draftFixture(e);d.revisionId=crypto.randomUUID();d.workspace.document.markdown='# 旧原文';
  const r=review(await l.recover(e.id,d));const selected=await l.resolveRecovery(r.id,'draft',e.version);expect(selected.entry.id).not.toBe(e.id);expect(selected.entry.source).toBeNull();expect((await l.get(e.id)).workspace.document.markdown).toBe(e.workspace.document.markdown);
  const orphan=draftFixture(e);orphan.entryId=crypto.randomUUID();const missing=review(await l.recover(orphan.entryId,orphan));expect(missing.disk).toBeNull();
  const recovered=await l.resolveRecovery(missing.id,'draft',null);expect(recovered.entry.source).toBeNull();expect((await new ReadingLibrary(dir).listRecoveries()).length).toBe(2);
 });
 it.each(['snapshot','intent','entry','confirmation'] as const)('survives a failed %s write and retry without lost data or duplicate entries',async(stage)=>{
  const {l,e,dir}=await setup();const d=draftFixture(e);d.revisionId=crypto.randomUUID();
  // Fault injection at durable boundaries, including a commit that succeeds before its response is lost.
  const internals=l as unknown as {saveRecovery:(r:RecoveryRecord)=>Promise<void>;commit:(e:unknown)=>Promise<unknown>};
  const save=internals.saveRecovery.bind(l),commit=internals.commit.bind(l);let fired=false;
  vi.spyOn(internals,'saveRecovery').mockImplementation(async(r)=>{
    if(!fired && ((stage==='snapshot'&&!r.intent&&r.state==='pending')||(stage==='intent'&&!!r.intent)||(stage==='confirmation'&&r.state==='resolved'))){fired=true;throw new Error('injected disk failure');}return save(r);
  });
  vi.spyOn(internals,'commit').mockImplementation(async(v)=>{const result=await commit(v);if(!fired&&stage==='entry'){fired=true;throw new Error('response lost');}return result;});
  if(stage==='snapshot')await expect(l.recover(e.id,d)).rejects.toThrow('injected');
  const r=review(await l.recover(e.id,d));
  if(stage!=='snapshot')await expect(l.resolveRecovery(r.id,'draft',e.version)).rejects.toThrow();
  const restart=new ReadingLibrary(dir);const result=await restart.resolveRecovery(r.id,'draft',e.version);
  expect(result.record.state).toBe('resolved');expect(await restart.listRecoveries()).toHaveLength(1);expect((await restart.list()).entries).toHaveLength(2);
  expect((await restart.getRecovery(r.id)).disk!.workspace.document.markdown).toBe(e.workspace.document.markdown);
 });
 it('rejects unsafe API requests and strips credentials and forged paths from persisted snapshots',async()=>{
  const {l,e,dir}=await setup();const server=createApp({library:l}).listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/library`;
  try {
   const path=`/entries/${e.id}/recover`,d=draftFixture(e);d.revisionId=crypto.randomUUID();Object.assign(d.workspace,{apiKey:'SECRET',sourcePath:'/private/file'});
   expect((await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})).status).toBe(401);
   expect((await fetch(base+'/recoveries',{headers:{Origin:'https://evil.test'}})).status).toBe(403);
   const {token}=await (await fetch(base+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();const headers={'Content-Type':'application/json','X-Got-It-Session':token};
   const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
   expect((await post('/entries/invalid/recover',d)).status).toBe(404);expect((await post(path,{...d,workspace:{}})).status).toBe(400);
   expect((await post(path,{...d,workspace:{...d.workspace,document:{...d.workspace.document,markdown:'x'.repeat(25*1024*1024)}}})).status).toBe(413);
   const response=await post(path,d);expect(response.ok).toBe(true);const r=review(await response.json());
   const raw=await readFile(join(dir,'recoveries',r.id+'.json'),'utf8');expect(raw).not.toContain('SECRET');expect(raw).not.toContain('/private/file');
   expect((await fetch(base+'/recoveries/'+r.id,{headers})).ok).toBe(true);
  }finally{server.close();await once(server,'close');}
 });
});
it('acknowledges only resolved events durably without replacing current content or snapshots',async()=>{
 const {l,e,dir}=await setup();const d=draftFixture(e);
 const disk=await l.save(e.id,e.version,e.revisionId,editReading(e.workspace,'磁盘回答'),e.position);
 const r=review(await l.recover(e.id,d));await expect(l.acknowledgeRecovery(r.id)).rejects.toMatchObject({status:409});
 const selected=await l.resolveRecovery(r.id,'disk',disk.version);
 const current=await l.save(e.id,selected.entry.version,e.revisionId,editReading(e.workspace,'后续新回答'),e.position);
 expect((await l.reviewRecovery(r.id)).current!.workspace.inquiries[0].messages[0].content).toBe('后续新回答');
 const ack=await l.acknowledgeRecovery(r.id);expect(ack.acknowledgedAt).toBeTruthy();
 expect((await l.acknowledgeRecovery(r.id)).acknowledgedAt).toBe(ack.acknowledgedAt);
 const restart=new ReadingLibrary(dir);expect((await restart.listRecoveries())[0].acknowledgedAt).toBe(ack.acknowledgedAt);
 expect((await restart.get(e.id)).workspace).toEqual(current.workspace);
 expect((await restart.getRecovery(r.id)).disk).toEqual(r.disk);
 expect((await restart.getRecovery(r.id)).current).toBeUndefined();
 const next=review(await restart.recover(e.id,{...d,id:crypto.randomUUID(),workspace:editReading(d.workspace,'新的冲突')}));expect(next.acknowledgedAt).toBeUndefined();
});
it('keeps reminders after acknowledgement write failure and supports retry',async()=>{
 const {l,e}=await setup();const d=draftFixture(e);d.revisionId=crypto.randomUUID();
 const r=review(await l.recover(e.id,d));await l.resolveRecovery(r.id,'disk',e.version);
 const internals=l as unknown as {saveRecovery:(r:RecoveryRecord)=>Promise<void>};
 const spy=vi.spyOn(internals,'saveRecovery').mockRejectedValueOnce(new Error('disk failure'));
 await expect(l.acknowledgeRecovery(r.id)).rejects.toThrow('disk failure');
 expect((await l.getRecovery(r.id)).acknowledgedAt).toBeUndefined();spy.mockRestore();
 expect((await l.acknowledgeRecovery(r.id)).acknowledgedAt).toBeTruthy();
});
it('refreshes pending review after navigation metadata changes without inventing content changes',async()=>{
 const {l,e}=await setup();const r=review(await l.recover(e.id,draftFixture(e)));
 const active=await l.activate(e.id);const fresh=await l.reviewRecovery(r.id);
 expect(fresh.disk!.version).toBe(active.version);expect(fresh.previous).toHaveLength(0);
 expect((await l.resolveRecovery(r.id,'disk',fresh.disk!.version)).record.state).toBe('resolved');
});
