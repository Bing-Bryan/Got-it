import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useReadingLibrary } from "../useReadingLibrary";
import { createInitialWorkspace } from "../sample";
import { DraftStore } from "./reading-recovery";
import { webWorkspace } from "../test-support/web";
import type { WebImportJob } from "./web-data";
import type { LibraryEntry } from "./library-types";
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("./library-client",()=>({libraryRequest:request,libraryBinary:vi.fn()}));
let root:Root,control:ReturnType<typeof useReadingLibrary>,current:ReturnType<typeof createInitialWorkspace>,interrupt:()=>void,job:WebImportJob,entry:LibraryEntry;
function Harness({initial=createInitialWorkspace()}:{initial?:ReturnType<typeof createInitialWorkspace>}){const[w,set]=useState(initial);current=w;control=useReadingLibrary({workspace:w,install:set,interrupt:()=>{interrupt();return w;}});return <div className="reader-scroll"/>;}
async function mount(initial=createInitialWorkspace(),expectReady=true){await act(async()=>{root=createRoot(document.body.appendChild(document.createElement("div")));root.render(<Harness initial={initial}/>);});await act(async()=>{await new Promise(r=>setTimeout(r,10));});expect(control.ready).toBe(expectReady);}
async function dispatch(path="",body?:Record<string,any>){if(!path)return{entries:[],activeId:null,warnings:[],nativePicker:true};if(path==="/recoveries")return[];if(path==="/web-imports"){job={operationId:body!.operationId,status:"ready",progress:"正文已读取",preview:{candidateId:"candidate",workspace:webWorkspace()}};return job;}if(path.endsWith("/cancel"))return{};if(path.endsWith("/confirm"))return entry;if(path.startsWith("/web-imports/"))return job;if(path.startsWith("/entries/"))return entry;throw Error(path);}
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});localStorage.clear();interrupt=vi.fn();entry={creationKey:"web-key",id:"web-entry",version:1,revisionId:"revision",workspace:webWorkspace(),position:{ratio:0},source:null,history:[],updatedAt:"2026",lastOpenedAt:"2026"};request.mockReset().mockImplementation(dispatch);});
afterEach(async()=>{await act(async()=>root?.unmount());document.body.innerHTML="";});
describe("web candidate lifecycle",()=>{
 it("retries a genuine legacy Markdown migration with the same key after initial failure",async()=>{
   const legacy=createInitialWorkspace();legacy.document.isDemo=false;let fail=true;const migrated={...entry,workspace:legacy};request.mockImplementation((p,b)=>{if(p==='/entries'){if(fail){fail=false;throw Error('migration failed');}return migrated;}return dispatch(p,b);});
   await mount(legacy,false);await act(async()=>control.retry());expect(control.ready).toBe(true);const adds=request.mock.calls.filter(([p])=>p==='/entries');expect(adds).toHaveLength(2);expect(adds[0][1].creationKey).toBe(adds[1][1].creationKey);expect(adds[1][1].workspace.document.kind).not.toBe('web');
 });
 it.each([true,false])("retains authorized disk media after failed draft recovery only for the same original (%s)",async matching=>{
   new DraftStore(localStorage,"web-failure-fixture").write(entry,entry.workspace,{ratio:.3});
   const disk=structuredClone(entry);if(!matching&&disk.workspace.document.kind==='web')disk.workspace.document.web.media[0].resourceId='c'.repeat(64);
   request.mockImplementation((p,b)=>{if(String(p).endsWith('/recover'))throw Error('本机图片缺失');if(String(p)===`/entries/${entry.id}`)return disk;return dispatch(p,b);});
   await mount();expect(control.blocked).toBe(true);expect(control.readOnly).toBe(true);expect(control.status).toBe('阅读进度暂未保存');expect(current.document.kind).toBe('web');expect(control.entry?.id??null).toBe(matching?entry.id:null);expect(new DraftStore(localStorage).read().drafts).toHaveLength(1);
   if(matching){request.mockImplementation((p,b)=>{if(!p)return{entries:[],activeId:entry.id,warnings:[],nativePicker:true};if(String(p).endsWith('/recover'))return{kind:'restored',entry};return dispatch(p,b);});await act(async()=>control.retry());expect(control.blocked).toBe(false);expect(control.entry?.id).toBe(entry.id);expect(request.mock.calls.some(([p])=>p==='/entries')).toBe(false);expect(new DraftStore(localStorage).read().drafts).toHaveLength(0);}
 });
 it("preview leaves the active material and requests untouched; only explicit confirmation installs",async()=>{await mount();await act(async()=>control.readWebUrl("https://claude.dev/article"));expect(current.document.isDemo).toBe(true);expect(interrupt).not.toHaveBeenCalled();expect(request.mock.calls.some(([p])=>String(p).endsWith("/confirm"))).toBe(false);await act(async()=>control.confirmWebImport(true));expect(current.document.kind).toBe("web");expect(control.status).toContain("部分内容未导入");expect(request.mock.calls.find(([p])=>String(p).endsWith("/confirm"))?.[1]).toMatchObject({candidateId:"candidate",allowPartial:true,creationKey:expect.any(String)});});
 it("cancellation ignores a late successful candidate",async()=>{await mount();let resolve!:(v:unknown)=>void;request.mockImplementation((path,body)=>path==="/web-imports"?new Promise(r=>resolve=r):dispatch(path,body));let read!:Promise<void>;await act(async()=>{read=control.readWebUrl("https://claude.dev/article");});const operationId=control.webJob!.operationId;await act(async()=>control.cancelWebImport(true));await act(async()=>{resolve({operationId,status:"ready",progress:"late",preview:{candidateId:"late",workspace:webWorkspace()}});await read;});expect(control.webJob).toBeNull();expect(control.webImportOpen).toBe(false);expect(current.document.isDemo).toBe(true);expect(interrupt).not.toHaveBeenCalled();});
 it("invalidates changed candidate before preserving active work",async()=>{await mount();await act(async()=>control.readWebUrl("https://claude.dev/article"));job={...job,preview:{candidateId:"changed",workspace:webWorkspace()}};await act(async()=>control.confirmWebImport());expect(control.webError).toContain("失效");expect(interrupt).not.toHaveBeenCalled();expect(current.document.isDemo).toBe(true);expect(request.mock.calls.some(([p])=>String(p).endsWith("/confirm"))).toBe(false);});
 it("reuses a stable creation key when confirmation response fails",async()=>{await mount();await act(async()=>control.readWebUrl("https://claude.dev/article"));let fail=true;request.mockImplementation((p,b)=>{if(String(p).endsWith("/confirm")&&fail){fail=false;throw Error("保存失败");}return dispatch(p,b);});await act(async()=>control.confirmWebImport(true));expect(control.webError).toContain("保存失败");await act(async()=>control.confirmWebImport(true));const confirms=request.mock.calls.filter(([p])=>String(p).endsWith("/confirm"));expect(confirms).toHaveLength(2);expect(confirms[0][1].creationKey).toBe(confirms[1][1].creationKey);expect(current.document.kind).toBe("web");});
 it("opens an existing saved URL without creating another candidate entry",async()=>{await mount();await act(async()=>control.readWebUrl("https://claude.dev/article#chart"));job={operationId:job.operationId,status:"existing",progress:"已保存",entryId:entry.id};request.mockImplementation((p,b)=>dispatch(p,b));await act(async()=>control.confirmWebImport());expect(current.document.kind).toBe("web");expect(request.mock.calls.some(([p])=>String(p).endsWith("/confirm"))).toBe(false);});
});

describe('one-action web reading',()=>{
 function complete(){if(entry.workspace.document.kind==='web')entry.workspace.document.web.media=entry.workspace.document.web.media.filter(m=>m.status==='saved');}
 function completeDispatch(){request.mockImplementation(async(p,b)=>{const result=await dispatch(p,b);if(p==='/web-imports'&&job.preview)job.preview.workspace=entry.workspace;return result;});}
 it('reads, saves and opens a complete article from one explicit action',async()=>{
  complete();completeDispatch();await mount();await act(async()=>control.readWebArticle('https://claude.dev/article'));expect(current.document.kind).toBe('web');expect(control.webImportOpen).toBe(false);expect(control.webImportSuccess).toBe(1);expect(request.mock.calls.filter(([p])=>String(p).endsWith('/confirm'))).toHaveLength(1);expect(request.mock.calls.find(([p])=>String(p).endsWith('/confirm'))?.[1].allowPartial).toBe(false);
 });
 it('retains the success signal until activation has actually returned',async()=>{
  complete();completeDispatch();await mount();const normal=request.getMockImplementation()!;
  request.mockImplementation((p,b)=>String(p).endsWith('/activate')?Promise.reject(Error('activate failed')):normal(p,b));
  await act(async()=>control.readWebArticle('https://claude.dev/article'));expect(control.webImportSuccess).toBe(0);expect(control.webImportOpen).toBe(true);expect(control.webError).toContain('activate failed');expect(current.document.isDemo).toBe(true);
 });
 it('rejects missing media without installing partial content and retries extraction explicitly',async()=>{
  await mount();await act(async()=>control.readWebArticle('https://claude.dev/article'));expect(control.webError).toContain('尚未加入');expect(current.document.isDemo).toBe(true);expect(interrupt).not.toHaveBeenCalled();expect(request.mock.calls.some(([p])=>String(p).endsWith('/confirm'))).toBe(false);await act(async()=>control.readWebArticle('https://claude.dev/article'));expect(request.mock.calls.filter(([p])=>p==='/web-imports')).toHaveLength(2);
 });
 it('ignores a late direct-read result after dismissal',async()=>{
  complete();await mount();let resolve!:(v:unknown)=>void;request.mockImplementation((p,b)=>p==='/web-imports'?new Promise(r=>resolve=r):dispatch(p,b));let read!:Promise<void>;await act(async()=>{read=control.readWebArticle('https://claude.dev/article');});const operationId=control.webJob!.operationId;await act(async()=>control.cancelWebImport(true));await act(async()=>{resolve({operationId,status:'ready',progress:'late',preview:{candidateId:'late',workspace:entry.workspace}});await read;});expect(control.webImportOpen).toBe(false);expect(current.document.isDemo).toBe(true);expect(request.mock.calls.some(([p])=>String(p).endsWith('/confirm'))).toBe(false);
 });
 it('keeps one candidate/key for save retry and blocks dismissal during commit',async()=>{
  complete();completeDispatch();await mount();let fail=true;const normal=request.getMockImplementation()!;request.mockImplementation((p,b)=>{if(String(p).endsWith('/confirm')&&fail){fail=false;throw Error('disk save failed');}return normal(p,b);});await act(async()=>control.readWebArticle('https://claude.dev/article'));expect(control.webError).toContain('disk save failed');expect(control.webImportSuccess).toBe(0);expect(current.document.isDemo).toBe(true);let commit!:(e:LibraryEntry)=>void;request.mockImplementation((p,b)=>String(p).endsWith('/confirm')?new Promise(r=>commit=r):normal(p,b));let retry!:Promise<void>;await act(async()=>{retry=control.readWebArticle('https://claude.dev/article');});expect(control.busy).toBe(true);await act(async()=>control.cancelWebImport(true));expect(control.webImportOpen).toBe(true);await act(async()=>{commit(entry);await retry;});expect(current.document.kind).toBe('web');const confirms=request.mock.calls.filter(([p])=>String(p).endsWith('/confirm'));expect(confirms).toHaveLength(2);expect(confirms[0][1].creationKey).toBe(confirms[1][1].creationKey);expect(request.mock.calls.filter(([p])=>p==='/web-imports')).toHaveLength(1);
 });
 it.each(['missing','expired','cancelled'])('starts afresh only after the saved candidate job is definitely %s',async reason=>{
  complete();completeDispatch();await mount();let fail=true;const normal=request.getMockImplementation()!;
  request.mockImplementation((p,b)=>{if(String(p).endsWith('/confirm')&&fail){fail=false;throw Error('response lost');}return normal(p,b);});
  await act(async()=>control.readWebArticle('https://claude.dev/article'));expect(control.webJob?.status).toBe('ready');
  request.mockImplementation((p,b)=>{if(String(p).startsWith('/web-imports/')&&!String(p).endsWith('/cancel')){if(reason==='missing')throw Object.assign(Error('job missing'),{status:404});return {...job,status:reason};}if(p==='/web-imports'){job={operationId:b!.operationId,status:'existing',progress:'已保存',entryId:entry.id};return job;}return dispatch(p,b);});
  await act(async()=>control.readWebArticle('https://claude.dev/article'));expect(control.webJob).toBeNull();expect(current.document.isDemo).toBe(true);
  request.mockImplementation((p,b)=>{if(p==='/web-imports'){job={operationId:b!.operationId,status:'existing',progress:'已保存',entryId:entry.id};return job;}return dispatch(p,b);});
  await act(async()=>control.readWebArticle('https://claude.dev/article'));expect(current.document.kind).toBe('web');expect(request.mock.calls.filter(([p])=>p==='/web-imports')).toHaveLength(2);expect(request.mock.calls.filter(([p])=>String(p).endsWith('/confirm'))).toHaveLength(1);
 });
 it('opens a duplicate directly without confirm or automatic model requests',async()=>{
  complete();await mount();request.mockImplementation((p,b)=>{if(p==='/web-imports'){job={operationId:b!.operationId,status:'existing',progress:'已保存',entryId:entry.id};return job;}return dispatch(p,b);});await act(async()=>control.readWebArticle('https://claude.dev/article'));expect(current.document.kind).toBe('web');expect(control.webImportSuccess).toBe(1);expect(request.mock.calls.some(([p])=>String(p).endsWith('/confirm')||String(p).includes('translation-batches'))).toBe(false);
 });
});
