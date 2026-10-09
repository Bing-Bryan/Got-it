import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadingLibrary } from '../../server/reading-library';
import { useReadingLibrary } from '../useReadingLibrary';
import { createInitialWorkspace } from '../sample';
import type { Workspace } from '../types';
import type { LibraryEntry } from './library-types';
import { restoreWorkspace } from './storage';
import { DraftStore, LEGACY_DRAFT_KEY } from './reading-recovery';
import { readingFixture, editReading, draftFixture } from '../test-support/recovery-fixture';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./library-client', () => ({ libraryRequest: request }));
let root: Root, control: ReturnType<typeof useReadingLibrary>, update: (w: Workspace)=>void, current: Workspace;
let l:ReadingLibrary,dir:string,a:LibraryEntry,b:LibraryEntry,failedSave:boolean;
function Harness({ initial }: { initial: Workspace }) {
 const [workspace,setWorkspace]=useState(initial);current=workspace;update=setWorkspace;
 control=useReadingLibrary({workspace,install:setWorkspace,interrupt:()=>{const w=restoreWorkspace(workspace)!;setWorkspace(w);return w;}});
 return <div className="reader-scroll"><article>{workspace.document.filename}</article></div>;
}
async function settle(){await act(async()=>{await new Promise(r=>setTimeout(r,25));});}
async function mount(initial=createInitialWorkspace()){
 const div=document.createElement('div');document.body.append(div);root=createRoot(div);
 await act(async()=>root.render(<Harness initial={initial}/>));
 for(let n=0;n<30&&(!control.ready||control.busy);n++)await settle();
 await settle();
 for(let n=0;n<30&&control.busy;n++)await settle();
}
async function change(text:string){await act(async()=>update(editReading(current,text)));}
async function dispatch(path='',body?:Record<string,unknown>):Promise<unknown>{
 if(path==='')return l.list();
 if(path==='/recoveries')return l.listRecoveries();
 if(path==='/entries')return l.add(body!.workspace,body!.creationKey as string);
 const [,area,id,op]=path.split('/');
 if(area==='recoveries')return op==='resolve'?l.resolveRecovery(id,body!.choice,body!.expectedVersion):op==='acknowledge'?l.acknowledgeRecovery(id):l.reviewRecovery(id);
 if(!op)return l.get(id);
 if(op==='check')return l.check(id);
 if(op==='activate')return l.activate(id);
 if(op==='recover'){if(failedSave)throw new Error('磁盘保存失败测试');return l.recover(id,body);}
 if(op==='save'){if(failedSave)throw new Error('磁盘保存失败测试');return l.save(id,body!.expectedVersion as number,body!.revisionId as string,body!.workspace,body!.position);}
 throw new Error('unexpected '+path);
}
beforeEach(async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});localStorage.clear();failedSave=false;
 dir=await mkdtemp(join(tmpdir(),'lifecycle-recovery-'));l=new ReadingLibrary(dir);a=await l.add(readingFixture('a.md'),'a');b=await l.add(readingFixture('b.md'),'b');a=await l.activate(a.id);
 request.mockImplementation(dispatch);
});
afterEach(async()=>{await act(async()=>root?.unmount());document.body.innerHTML='';vi.restoreAllMocks();await rm(dir,{recursive:true,force:true});});
describe('reading library lifecycle',()=>{
 it('opens, saves changes and switches without losing either article',async()=>{
  await mount();await change('修改的回答');await act(async()=>{await control.open(b.id);});
  expect(current.document.filename).toBe('b.md');expect((await l.get(a.id)).workspace.inquiries[0].messages[0].content).toBe('修改的回答');
 });
 it('keeps current material and emergency draft on disk failure, retries successfully',async()=>{
  await mount();await change('未保存');failedSave=true;await act(async()=>{await control.open(b.id);});
  expect(current.document.filename).toBe('a.md');expect(control.status).toBe('阅读进度暂未保存');expect(new DraftStore(localStorage).read().drafts).toHaveLength(1);
  failedSave=false;await act(async()=>{await control.retry();});expect(control.status).toBe('已保存到本机');expect(new DraftStore(localStorage).read().drafts).toHaveLength(0);
 });
 it('validates target before interrupting or saving',async()=>{
  await mount();await change('保留');await act(async()=>{await control.open(crypto.randomUUID());});expect(current.document.filename).toBe('a.md');expect(control.error).toBeTruthy();
  expect((await l.get(a.id)).workspace.inquiries[0].messages[0].content).toBe('原来的回答');
 });
 it('saves during continuous updates',async()=>{
  await mount();for(let i=0;i<7;i++)await act(async()=>{update(editReading(current,'流式'+i));await new Promise(r=>setTimeout(r,110));});
  expect((await l.get(a.id)).workspace.inquiries[0].messages[0].content).toContain('流式');
 });
 it('does not clear newer edits when an older write finishes',async()=>{
  await mount();let release!:()=>void;let held=false;
  request.mockImplementation(async(path,body)=>{if(String(path).endsWith('/save')&&!held){held=true;await new Promise<void>(r=>release=r);}return dispatch(path,body);});
  await change('第一份');let job:Promise<unknown>;await act(async()=>{job=control.retry();await Promise.resolve();});await change('后一份');
  await act(async()=>{release();await job!;});expect(control.status).toBe('保存中…');expect(new DraftStore(localStorage).read().drafts[0].draft.workspace.inquiries[0].messages[0].content).toBe('后一份');
  await act(async()=>{await control.retry();});expect((await l.get(a.id)).workspace.inquiries[0].messages[0].content).toBe('后一份');
 });
 it('silently clears identical legacy leftovers and ignores unchanged scrolling',async()=>{
  localStorage.setItem(LEGACY_DRAFT_KEY,JSON.stringify({...draftFixture(a),workspace:a.workspace,position:a.position}));
  await mount();expect(control.recovery).toBeNull();expect(control.recoveries).toHaveLength(0);expect(localStorage.getItem(LEGACY_DRAFT_KEY)).toBeNull();
  await act(async()=>{control.rendered();control.scrolled();await control.retry();});expect(new DraftStore(localStorage).read().drafts).toHaveLength(0);
 });
 it('asks about different legacy content even with a matching baseline and preserves preferences',async()=>{
  localStorage.setItem(LEGACY_DRAFT_KEY,JSON.stringify(draftFixture(a)));
  await mount();expect(control.recovery?.state).toBe('pending');expect(current.inquiries[0].messages[0].content).toBe('原来的回答');expect(current.activeProviderId).toBe('codex');
 });
 it('preserves conflicting records before switching and provides durable return/review',async()=>{
  localStorage.setItem(LEGACY_DRAFT_KEY,JSON.stringify(draftFixture(a)));await l.save(a.id,a.version,a.revisionId,editReading(a.workspace,'磁盘回答'),a.position);
  await mount();expect(control.recoveries).toHaveLength(1);const id=control.recoveries[0].id;
  await act(async()=>{await control.open(b.id);});expect(current.document.filename).toBe('b.md');
  await act(async()=>{await control.showRecovery(id);});expect(control.recovery?.draft.workspace.inquiries[0].messages[0].content).toBe('尚未保存的回答');
  await act(async()=>{await control.resolveRecovery('draft');});expect(current.inquiries[0].messages[0].content).toBe('尚未保存的回答');expect(control.recoveries[0].state).toBe('resolved');expect((await l.list()).activeId).toBe(a.id);
 });
 it('blocks leaving when a startup draft cannot be persisted, then resumes recovery',async()=>{
  localStorage.setItem(LEGACY_DRAFT_KEY,JSON.stringify(draftFixture(a)));failedSave=true;await mount();expect(control.blocked).toBe(true);
  await act(async()=>{await control.open(b.id);});expect(current.document.filename).toBe('a.md');expect(control.error).toContain('先保存');expect(localStorage.getItem(LEGACY_DRAFT_KEY)).not.toBeNull();
  failedSave=false;await act(async()=>{await control.retry();});expect(control.blocked).toBe(false);await settle();expect(control.recoveries.some(r=>r.state==='pending')).toBe(true);
 });
 it('keeps corrupted data and separately protects readable orphan drafts',async()=>{
  localStorage.setItem(LEGACY_DRAFT_KEY,'broken');const d=draftFixture(a);d.entryId=crypto.randomUUID();localStorage.setItem('got-it.library.draft.v2.orphan',JSON.stringify(d));
  await mount();expect(control.draftWarning).toContain('损坏');expect(localStorage.getItem(LEGACY_DRAFT_KEY)).toBe('broken');expect(control.recoveries).toHaveLength(1);
  await act(async()=>{await control.showRecovery(control.recoveries[0].id);});expect(control.recovery?.disk).toBeNull();
 });
 it('turns a live save conflict into retained review instead of overwriting',async()=>{
  await mount();await l.save(a.id,a.version,a.revisionId,editReading(a.workspace,'另一页面回答'),a.position);await change('当前页面回答');
  await act(async()=>{await control.retry();});expect(control.recovery?.state).toBe('pending');expect((await l.get(a.id)).workspace.inquiries[0].messages[0].content).toBe('另一页面回答');expect(new DraftStore(localStorage).read().drafts).toHaveLength(0);
  await act(async()=>{control.closeRecovery();await control.open(b.id);});expect(current.document.filename).toBe('b.md');
 });
 it('clears an intermediate scroll draft after returning to the saved position',async()=>{
  await mount();await act(async()=>control.rendered());const el=document.querySelector<HTMLElement>('.reader-scroll')!;
  Object.defineProperty(el,'scrollHeight',{value:1000});Object.defineProperty(el,'clientHeight',{value:200});
  await act(async()=>{el.scrollTop=200;control.scrolled();});expect(new DraftStore(localStorage).read().drafts).toHaveLength(1);
  await act(async()=>{el.scrollTop=0;control.scrolled();await control.retry();});expect(new DraftStore(localStorage).read().drafts).toHaveLength(0);
 });
 it('returns to every retained conflict and never creates drafts in historic read-only mode',async()=>{
  const store=new DraftStore(localStorage,'fixtures');store.write(a,editReading(a.workspace,'草稿一'),a.position);store.write(b,editReading(b.workspace,'草稿二'),b.position);
  await l.save(a.id,a.version,a.revisionId,editReading(a.workspace,'磁盘一'),a.position);await l.save(b.id,b.version,b.revisionId,editReading(b.workspace,'磁盘二'),b.position);
  await mount();expect(control.recoveries).toHaveLength(2);
  for(const r of control.recoveries){await act(async()=>{await control.showRecovery(r.id);});expect(control.recovery?.id).toBe(r.id);await act(async()=>control.closeRecovery());}
  // An unknown historical id still enforces read-only, without writing a new draft.
  await act(async()=>{await control.viewRevision('historic');});await change('只读不能保存');await act(async()=>{await control.retry();control.scrolled();});
  expect(new DraftStore(localStorage).read().drafts).toHaveLength(0);expect(control.readOnly).toBe(true);
 });

 it('does not duplicate a conflict after a lost recovery response',async()=>{
  await mount();await l.save(a.id,a.version,a.revisionId,editReading(a.workspace,'另一份内容'),a.position);await change('需要保护的内容');
  let lost=false;request.mockImplementation(async(path,body)=>{const result=await dispatch(path,body);if(String(path).endsWith('/recover')&&!lost){lost=true;throw new Error('响应丢失');}return result;});
  await act(async()=>{await control.retry();});expect(control.blocked).toBe(true);expect(await l.listRecoveries()).toHaveLength(1);
  await act(async()=>{await control.retry();});expect(control.blocked).toBe(false);expect(await l.listRecoveries()).toHaveLength(1);
 });

});
it('keeps a resolved review open on acknowledgement failure, then confirms current content',async()=>{
 const d=draftFixture(a);const disk=await l.save(a.id,a.version,a.revisionId,editReading(a.workspace,'磁盘回答'),a.position);
 const r=await l.recover(a.id,d);if(r.kind!=='review')throw new Error('review expected');
 await mount();await act(async()=>control.showRecovery(r.record.id));
 request.mockImplementation(async(path='',body)=>{if(path.endsWith('/acknowledge'))throw new Error('确认保存失败');return dispatch(path,body);});
 await act(async()=>control.resolveRecovery('disk'));
 expect(control.error).toContain('确认保存失败');expect(control.recovery?.state).toBe('resolved');expect(control.recovery?.acknowledgedAt).toBeUndefined();
 const latest=await l.get(a.id);await l.save(a.id,latest.version,latest.revisionId,editReading(latest.workspace,'后续回答'),latest.position);
 request.mockImplementation(dispatch);await act(async()=>control.acknowledgeRecovery());
 expect(control.recovery).toBeNull();expect(current.inquiries[0].messages[0].content).toBe('后续回答');expect(control.recoveries[0].acknowledgedAt).toBeTruthy();
});
it('prompts once per visit, reminds after reopening, and never reminds after choosing',async()=>{
 localStorage.setItem(LEGACY_DRAFT_KEY,JSON.stringify(draftFixture(a)));
 await mount();expect(control.recovery?.state).toBe('pending');
 const id=control.recovery!.id;
 await act(async()=>control.closeRecovery());await settle();expect(control.recovery).toBeNull();
 await act(async()=>control.open(b.id));await settle();expect(control.recovery).toBeNull();
 await act(async()=>control.open(a.id));await settle();for(let i=0;i<20&&control.busy;i++)await settle();expect(control.recovery?.id).toBe(id);
 await act(async()=>control.resolveRecovery('disk'));await settle();expect(control.recovery).toBeNull();
 await act(async()=>control.open(b.id));await act(async()=>control.open(a.id));await settle();expect(control.recovery).toBeNull();
 expect((await l.getRecovery(id)).draft.workspace.inquiries[0].messages[0].content).toBe('尚未保存的回答');
});
it('does not prompt already chosen legacy events without acknowledgement metadata',async()=>{
 const d=draftFixture(a),r=await l.recover(a.id,d);if(r.kind!=='review')throw new Error('review expected');
 await l.resolveRecovery(r.record.id,'disk',a.version);
 await mount();expect(control.recoveries[0].acknowledgedAt).toBeUndefined();expect(control.recovery).toBeNull();
});
it('does not immediately replace a dismissed dialog with another already-known recovery for the same article',async()=>{
 await l.recover(a.id,draftFixture(a,'保留记录甲'));
 await l.recover(a.id,draftFixture(a,'保留记录乙'));
 await mount();expect(control.recovery).not.toBeNull();
 await act(async()=>control.closeRecovery());await settle();await settle();
 expect(control.recovery).toBeNull();
 await act(async()=>control.open(b.id));await act(async()=>control.open(a.id));
 // Reopening schedules an effect that reads the recovery from disk; await its result.
 await vi.waitFor(async()=>{
  await settle();
  expect(control.busy).toBe(false);
  expect(control.recovery).not.toBeNull();
 },{timeout:2000,interval:25});
});
