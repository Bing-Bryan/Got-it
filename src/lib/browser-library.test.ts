import 'fake-indexeddb/auto';
import {webcrypto} from 'node:crypto';
import {beforeEach,describe,expect,it} from 'vitest';
import {browserBinary,browserRequest,browserBackup,restoreBrowserBackup,sha256} from './browser-library';
import {createInitialWorkspace} from '../sample';
import type {LibraryEntry,LibraryList} from './library-types';
import {canonical} from './reading-recovery';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
async function clear(){await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('got-it.browser-library.v1');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
const workspace=()=>{const w=createInitialWorkspace();return {...w,document:{...w.document,id:crypto.randomUUID(),isDemo:false}};};
async function add(){return browserRequest<LibraryEntry>('/entries',{workspace:workspace(),creationKey:crypto.randomUUID()});}
beforeEach(clear);
describe('browser library transaction and portability',()=>{
 it('commits and reopens original, knowledge state and reading position',async()=>{const e=await add();const next=await browserRequest<LibraryEntry>(`/entries/${e.id}/save`,{expectedVersion:1,workspace:e.workspace,position:{ratio:.42,blockId:'b-1',offset:10}});expect(next.version).toBe(2);expect((await browserRequest<LibraryEntry>(`/entries/${e.id}`)).position).toEqual({ratio:.42,blockId:'b-1',offset:10});});
 it('does not overwrite a newer tab and protects both drafts in a recovery record',async()=>{const e=await add();await browserRequest(`/entries/${e.id}/save`,{expectedVersion:1,workspace:e.workspace,position:{ratio:.2}});await expect(browserRequest(`/entries/${e.id}/save`,{expectedVersion:1,workspace:e.workspace,position:{ratio:.8}})).rejects.toMatchObject({status:409});const r=await browserRequest<any>(`/entries/${e.id}/recover`,{entryId:e.id,version:1,revisionId:e.revisionId,workspace:e.workspace,position:{ratio:.8}});expect(r.kind).toBe('review');expect((await browserRequest<LibraryEntry>(`/entries/${e.id}`)).position.ratio).toBe(.2);const resolved=await browserRequest<any>(`/recoveries/${r.record.id}/resolve`,{choice:'draft',expectedVersion:2});expect(resolved.entry.id).not.toBe(e.id);expect(resolved.entry.position.ratio).toBe(.8);});
 it('refreshes current recovery version after another tab saves without rewriting the historic snapshot',async()=>{const e=await add();const v2=await browserRequest<LibraryEntry>(`/entries/${e.id}/save`,{expectedVersion:1,workspace:e.workspace,position:{ratio:.2}});const r=await browserRequest<any>(`/entries/${e.id}/recover`,{entryId:e.id,version:1,revisionId:e.revisionId,workspace:e.workspace,position:{ratio:.8}});await browserRequest(`/entries/${e.id}/save`,{expectedVersion:2,workspace:e.workspace,position:{ratio:.3}});await expect(browserRequest(`/recoveries/${r.record.id}/resolve`,{choice:'draft',expectedVersion:2})).rejects.toMatchObject({status:409});const latest=await browserRequest<any>(`/recoveries/${r.record.id}`);expect(latest.disk.version).toBe(v2.version);expect(latest.current.version).toBe(3);const resolved=await browserRequest<any>(`/recoveries/${r.record.id}/resolve`,{choice:'draft',expectedVersion:latest.current.version});expect(resolved.entry.position.ratio).toBe(.8);expect((await browserRequest<LibraryEntry>(`/entries/${e.id}`)).position.ratio).toBe(.3);});
 it('restores complete validated backup into an empty library',async()=>{const e=await add();const backup=await browserBackup();await clear();await restoreBrowserBackup(backup);expect((await browserRequest<LibraryEntry>(`/entries/${e.id}`)).workspace.document).toEqual(e.workspace.document);});
 it('rejects corruption and conflicts atomically without changing existing content',async()=>{const e=await add(),backup=await browserBackup(),bad=JSON.parse(backup);bad.payload.entries[0].workspace.document.filename='tampered';await expect(restoreBrowserBackup(JSON.stringify(bad))).rejects.toThrow('完整性');await expect(restoreBrowserBackup(backup)).rejects.toMatchObject({status:409});expect((await browserRequest<LibraryList>()).entries).toHaveLength(1);expect((await browserRequest<LibraryEntry>(`/entries/${e.id}`)).workspace.document.filename).toBe(e.workspace.document.filename);});
 it('strips extra credential fields in workspaces and imported entry envelopes',async()=>{await browserRequest('/entries',{workspace:{...workspace(),apiKey:'SECRET',trialId:'PRIVATE'},creationKey:'safe'});const raw=JSON.parse(await browserBackup());raw.payload.entries[0].apiKey='SECRET';raw.payload.entries[0].workspace.apiKey='SECRET';raw.sha256=await sha256(canonical(raw.payload));await clear();await restoreBrowserBackup(JSON.stringify(raw));expect(await browserBackup()).not.toMatch(/SECRET|PRIVATE|apiKey|trialId/);});
 it('rejects a backup with missing PDF dependencies without partial restore',async()=>{const e=await add(),raw=JSON.parse(await browserBackup());raw.payload.entries[0].workspace.document={id:'pdf',kind:'pdf',filename:'x.pdf',contentHash:'a'.repeat(64),isDemo:false,importedAt:new Date().toISOString(),pdf:{resourceId:'a'.repeat(64),pages:[{view:[0,0,600,800],rotation:0}]}};raw.sha256=await sha256(canonical(raw.payload));await expect(restoreBrowserBackup(JSON.stringify(raw))).rejects.toThrow('资源缺失');expect((await browserRequest<LibraryEntry>(`/entries/${e.id}`)).workspace.document.kind).not.toBe('pdf');});
 it('does not resolve a failed commit as saved',async()=>{const proto=IDBObjectStore.prototype,original=proto.put;proto.put=function(){throw new DOMException('full','QuotaExceededError');};try{await expect(add()).rejects.toThrow();}finally{proto.put=original;}expect((await browserRequest<LibraryList>()).entries).toHaveLength(0);});
});

describe('selected PDF regions in the browser library',()=>{
 async function pdfEntry(){const pdfBytes=new TextEncoder().encode('%PDF-fixture'),pdfId=await sha256(pdfBytes);await add();const raw=JSON.parse(await browserBackup());
  raw.payload.entries[0].workspace.document={id:'pdf',kind:'pdf',filename:'x.pdf',contentHash:pdfId,isDemo:false,importedAt:new Date().toISOString(),pdf:{resourceId:pdfId,pages:[{view:[0,0,612,792],rotation:0}]}};
  raw.payload.resources.push({id:pdfId,type:'application/pdf',base64:Buffer.from(pdfBytes).toString('base64')});raw.sha256=await sha256(canonical(raw.payload));
  await clear();await restoreBrowserBackup(JSON.stringify(raw));return {entry:(await browserRequest<LibraryList>()).entries[0],pdfId};}
 const png=()=>{const b=new Uint8Array(40);b.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);b.set(new TextEncoder().encode('IHDR'),12);return new Blob([b],{type:'image/png'});};
 it('stores a crop and OCR text that reload and survive a full backup',async()=>{
  const {entry,pdfId}=await pdfEntry();const q=new URLSearchParams({fileHash:pdfId,page:'1',rect:'[0,0,10,10]'});
  const {id}=await (await browserBinary(`/entries/${entry.id}/crops?${q}`,png())).json();expect(id).toMatch(/^[a-f0-9]{64}$/);
  const ocr=await browserRequest<{id:string;data:{page:number}}>(`/entries/${entry.id}/ocr`,{version:1,fileHash:pdfId,page:1,lines:[{text:'Max Logits',rect:[0,0,10,10],block:'region'}]});
  expect(ocr.data.page).toBe(1);
  // Reference both from a saved note, as a real region question does.
  const current=await browserRequest<LibraryEntry>(`/entries/${entry.id}`),doc=current.workspace.document;
  const inquiry={id:'inquiry-1',intent:'explain',question:'q',status:'ready',createdAt:'2026-10-16T00:00:00.000Z',updatedAt:'2026-10-16T00:00:00.000Z',understanding:'',messages:[],anchor:{documentId:doc.id,blockId:`pdf-1-${id}`,headingPath:['第 1 页'],quote:'第 1 页 · 所选区域',prefix:'',suffix:'',start:0,end:0,matchStatus:'matched',pdf:{kind:'region',source:'image',fileHash:pdfId,page:1,rects:[[0,0,10,10]],cropId:id,ocrId:ocr.id,originalText:'Max Logits',context:'Max Logits'}}};
  await browserRequest(`/entries/${entry.id}/save`,{expectedVersion:current.version,workspace:{...current.workspace,inquiries:[inquiry]},position:{ratio:0}});
  const backup=await browserBackup();await clear();await restoreBrowserBackup(backup);
  expect((await (await browserBinary(`/entries/${entry.id}/resources/${id}`)).arrayBuffer()).byteLength).toBe(40);
  expect(await (await browserBinary(`/entries/${entry.id}/resources/${ocr.id}`)).json()).toMatchObject({page:1,lines:[{text:'Max Logits'}]});
 });
 it('leaves abandoned crops and OCR text out of backups while keeping referenced files',async()=>{
  const {entry,pdfId}=await pdfEntry();const q=new URLSearchParams({fileHash:pdfId,page:'1'});
  const {id:crop}=await (await browserBinary(`/entries/${entry.id}/crops?${q}`,png())).json();
  const {id:ocr}=await browserRequest<{id:string}>(`/entries/${entry.id}/ocr`,{version:1,fileHash:pdfId,page:1,lines:[{text:'x',rect:[0,0,10,10],block:'region'}]});
  const ids=JSON.parse(await browserBackup()).payload.resources.map((r:{id:string})=>r.id);
  expect(ids).toContain(pdfId);expect(ids).not.toContain(crop);expect(ids).not.toContain(ocr);
 });
 it('rejects OCR lines outside the page',async()=>{
  const {entry,pdfId}=await pdfEntry();
  await expect(browserRequest(`/entries/${entry.id}/ocr`,{version:1,fileHash:pdfId,page:1,lines:[{text:'x',rect:[0,0,700,10],block:'region'}]})).rejects.toThrow('超出原页');
 });
 it('rejects non-PNG crops and crops for another file or page',async()=>{
  const {entry,pdfId}=await pdfEntry();
  await expect(browserBinary(`/entries/${entry.id}/crops?${new URLSearchParams({fileHash:pdfId,page:'1'})}`,new Blob(['GIF89a'.padEnd(40,'x')],{type:'image/png'}))).rejects.toThrow('图片无效');
  for(const q of [{fileHash:'b'.repeat(64),page:'1'},{fileHash:pdfId,page:'2'}])await expect(browserBinary(`/entries/${entry.id}/crops?${new URLSearchParams(q)}`,png())).rejects.toThrow('不符');
  await expect(browserRequest(`/entries/${entry.id}/ocr`,{version:1,fileHash:pdfId,page:2,lines:[]})).rejects.toThrow('不符');
 });
});
