import 'fake-indexeddb/auto';
import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {browserRequest,browserBinary,browserBackup,restoreBrowserBackup,sha256} from './browser-library';
import {webWorkspace} from '../test-support/web';
import {buildTranslationSource} from './web-translation';
import type {LibraryEntry,LibraryList} from './library-types';
import type {WebImportJob} from './web-data';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
async function clear(){await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase('got-it.browser-library.v1');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
beforeEach(async()=>{await clear();localStorage.clear();});
afterEach(()=>vi.unstubAllGlobals());
async function fixture(options:{badHash?:boolean;changed?:boolean;missing?:boolean}={}){
 const bytes=new Uint8Array([1,2,3,4]),hash=await sha256(bytes),workspace=webWorkspace();
 if(workspace.document.kind!=='web')throw Error();workspace.document.web.media=[{id:'image-one',kind:'image',status:'saved',alt:'Safe image',resourceId:hash,mime:'image/png',bytes:bytes.length}];
 if(options.missing)workspace.document.web.media.push({id:'missing',kind:'image',status:'missing',alt:'Missing',reason:'Unavailable',sourceUrl:'https://example.com/missing.png'});
 const op=crypto.randomUUID();let polls=0;
 const job:WebImportJob={operationId:op,status:'ready',progress:'ready',preview:{candidateId:'candidate',workspace,retryTickets:options.missing?{missing:'signed-retry-ticket'}:{}}};
 const fetcher=vi.fn(async(raw:RequestInfo|URL,init?:RequestInit)=>{const url=String(raw);
  if(url.includes('/resources/'))return new Response(options.badHash?new Uint8Array([9]):bytes,{headers:{'Content-Type':'image/png'}});
  if(url.endsWith('/release')||url.endsWith('/cancel'))return Response.json({});
  if(init?.method==='GET'){polls++;return Response.json(options.changed&&polls>=2?{...job,preview:{...job.preview,candidateId:'changed'}}:job);}
  return Response.json(job);
 });vi.stubGlobal('fetch',fetcher);return {op,job,workspace,bytes,hash,fetcher};
}
async function imported(f:Awaited<ReturnType<typeof fixture>>,allowPartial=false){await browserRequest('/web-imports',{url:'https://claude.dev/blog/article/',operationId:f.op});return browserRequest<LibraryEntry&{webImportCreated:boolean}>(`/web-imports/${f.op}/confirm`,{candidateId:'candidate',creationKey:crypto.randomUUID(),allowPartial});}
it('downloads and atomically stores browser web media, then reopens and restores offline with scoped resource access',async()=>{
 const f=await fixture({missing:true}),e=await imported(f,true);
 expect(e.webImportCreated).toBe(true);expect((await browserRequest<LibraryList>()).entries[0].url).toBe('https://claude.dev/blog/article/#chart');
 const headers=f.fetcher.mock.calls[0][1]?.headers as Record<string,string>;expect(headers['X-Hosted-Operation-Token']).toMatch(/^[a-f0-9]{64}$/);
 const backup=await browserBackup();expect(backup).toContain('signed-retry-ticket');expect(backup).not.toContain(headers['X-Hosted-Operation-Token']);expect(backup).not.toContain(headers['X-Trial-Id']);
 await clear();await restoreBrowserBackup(backup);f.fetcher.mockImplementation(async()=>{throw Error('offline');});
 const response=await browserBinary(`/entries/${e.id}/web-resources/${e.revisionId}/${f.hash}`);expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.bytes);
 const other=await browserRequest<LibraryEntry>('/entries',{workspace:{...f.workspace,document:{...f.workspace.document,id:'other-doc',...(f.workspace.document.kind==='web'?{web:{...f.workspace.document.web,media:[]}}:{})}},creationKey:crypto.randomUUID()});
 await expect(browserBinary(`/entries/${other.id}/web-resources/${other.revisionId}/${f.hash}`)).rejects.toThrow('不属于');
});
it.each([{badHash:true},{changed:true}])('does not commit any entry after resource corruption or candidate replacement: %j',async options=>{const f=await fixture(options);await expect(imported(f)).rejects.toThrow();expect((await browserRequest<LibraryList>()).entries).toHaveLength(0);expect(JSON.parse(await browserBackup()).payload.resources).toHaveLength(0);});
it('does not commit a cancelled candidate or refetch an already saved equivalent URL',async()=>{
 const f=await fixture();await browserRequest('/web-imports',{url:'https://claude.dev/blog/article/',operationId:f.op});await browserRequest(`/web-imports/${f.op}/cancel`,{});await expect(browserRequest(`/web-imports/${f.op}/confirm`,{candidateId:'candidate',creationKey:'safe'})).rejects.toThrow('取消');
 const next=await fixture(),e=await imported(next);next.fetcher.mockClear();
 const job=await browserRequest<WebImportJob>('/web-imports',{url:'https://claude.dev/blog/article/#different',operationId:crypto.randomUUID()});expect(job.entryId).toBe(e.id);expect(next.fetcher).not.toHaveBeenCalled();
});
it('sends only the selected translation batch with truthful model metadata retained locally',async()=>{
 const f=await fixture(),e=await imported(f);if(e.workspace.document.kind!=='web')throw Error();const source=buildTranslationSource(e.workspace.document.markdown,e.workspace.document.web),first=source.units[0];
 f.fetcher.mockImplementation(async()=>Response.json({operationId:'batch',translationId:'translation',sourceVersion:e.workspace.document.contentHash,modelConfig:{model:'deepseek-flash',reasoningEffort:'none'},providerId:'deepseek',units:{[first.id]:'译文'}}));
 const result=await browserRequest<any>(`/entries/${e.id}/translation-batches`,{operationId:'batch',roundId:'round',revisionId:e.revisionId,sourceVersion:e.workspace.document.contentHash,translationId:'translation',unitIds:[first.id],modelConfig:{model:'gpt-6-luna',reasoningEffort:'medium'}});
 const body=JSON.parse(f.fetcher.mock.calls.at(-1)![1]!.body as string);expect(body.units).toEqual([first]);expect(body).not.toHaveProperty('workspace');expect(body).not.toHaveProperty('modelConfig');expect(result.providerId).toBe('deepseek');expect(result.modelConfig.reasoningEffort).toBe('none');
 await expect(browserRequest(`/entries/${e.id}/translation-batches`,{operationId:'bad',revisionId:e.revisionId,sourceVersion:e.workspace.document.contentHash,unitIds:['unknown']})).rejects.toThrow('超出范围');
});
it('preserves missing-image retry tickets across backup and rejects mismatched retry results without changing saved material',async()=>{
 const f=await fixture({missing:true}),e=await imported(f,true),backup=await browserBackup();await clear();await restoreBrowserBackup(backup);
 f.fetcher.mockImplementation(async()=>Response.json({documentId:'wrong',contentVersion:e.workspace.document.contentHash,media:{id:'missing'},resource:{}}));
 await expect(browserRequest(`/entries/${e.id}/web-media/missing/retry`,{revisionId:e.revisionId})).rejects.toThrow('不匹配');
 expect((await browserRequest<LibraryEntry>(`/entries/${e.id}`)).version).toBe(1);
});
