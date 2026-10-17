import 'fake-indexeddb/auto';
import {webcrypto} from 'node:crypto';
import {act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('./lib/runtime-mode',()=>({HOSTED:true}));
import {useReadingLibrary} from './useReadingLibrary';
import {createInitialWorkspace} from './sample';
import * as client from './lib/library-client';
import {browserRequest} from './lib/browser-library';
import type {LibraryList} from './lib/library-types';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
let root:Root,control:ReturnType<typeof useReadingLibrary>;
function Harness(){const [workspace,set]=useState(createInitialWorkspace);control=useReadingLibrary({workspace,install:set,interrupt:()=>workspace});return null;}
beforeEach(async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});localStorage.clear();await new Promise<void>(resolve=>{const r=indexedDB.deleteDatabase('got-it.browser-library.v1');r.onsuccess=()=>resolve();});const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root.render(<Harness/>);});for(let i=0;i<40&&(!control.ready||control.busy);i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});expect(control.ready).toBe(true);});
afterEach(async()=>{vi.restoreAllMocks();await act(async()=>root.unmount());document.body.innerHTML='';});
it('does not add welcome material until an explicit first action, and combines concurrent preparations',async()=>{expect((await browserRequest<LibraryList>()).entries).toHaveLength(0);let first:any,second:any;await act(async()=>{[first,second]=await Promise.all([control.ensureEntry(),control.ensureEntry()]);});expect(first.id).toBe(second.id);expect((await browserRequest<LibraryList>()).entries).toHaveLength(1);expect(control.entry?.id).toBe(first.id);expect(control.status).toBe('已保存到当前浏览器');});
it('keeps the first action retryable when the browser refuses to save',async()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError');};try{await act(async()=>{await expect(control.ensureEntry()).rejects.toThrow();});expect(control.entry).toBeNull();}finally{IDBObjectStore.prototype.put=original;}await act(async()=>{await control.ensureEntry();});expect((await browserRequest<LibraryList>()).entries).toHaveLength(1);});

it('locks material transitions while the first entry transaction is pending',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const original=client.libraryRequest;
 const spy=vi.spyOn(client,'libraryRequest').mockImplementation((async(path='',body?:unknown)=>{if(path==='/entries')await gate;return original(path,body);}) as typeof original);
 let preparation!:ReturnType<typeof control.ensureEntry>;await act(async()=>{preparation=control.ensureEntry();});expect(control.busy).toBe(true);await act(async()=>{await control.importFile(new File(['# another material'],'another.md',{type:'text/markdown'}));});expect((await browserRequest<LibraryList>()).entries).toHaveLength(0);
 await act(async()=>{release();await preparation;});expect(control.busy).toBe(false);expect(control.entry?.workspace.document.filename).not.toBe('another.md');expect((await browserRequest<LibraryList>()).entries).toHaveLength(1);spy.mockRestore();
});
