import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {BookmarkAction} from './BookmarkAction';
import {BookmarksView} from './BookmarksView';
import type {BookmarkResult,ReadingBookmark} from './lib/bookmark-types';
const {api}=vi.hoisted(()=>({api:vi.fn()}));vi.mock('./lib/library-client',()=>({libraryRequest:api}));
let root:Root,host:HTMLDivElement;
const anchor={documentId:'doc',blockId:'block',quote:'useful original',start:0,end:15,prefix:'',suffix:'',headingPath:[],matchStatus:'matched' as const};
const b:ReadingBookmark={id:'one',version:1,createdAt:'2026-10-15T00:00:00Z',creationOperationId:'created',entryId:'entry',revisionId:'rev',documentId:'doc',contentVersion:'hash',sourceKind:'markdown',sourceTitle:'Safe title',anchor,excerpt:anchor.quote,contextBefore:'before ',contextAfter:' after'};
const result:BookmarkResult={bookmark:b,created:true,revision:1};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();api.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function click(selector:string){await act(async()=>host.querySelector<HTMLButtonElement>(selector)!.click());}
it('keeps a failed selection retry on the identical operation and only reports saved after commit',async()=>{
 api.mockResolvedValueOnce({bookmark:null}).mockRejectedValueOnce(new Error('disk failed')).mockResolvedValueOnce(result);const onSaved=vi.fn();
 await act(async()=>root.render(<BookmarkAction entryId="entry" revisionId="rev" anchor={anchor} onSaved={onSaved}/>));await click('button');expect(host.textContent).toContain('disk failed');expect(onSaved).not.toHaveBeenCalled();const first=api.mock.calls[1][1];await click('button');expect(api.mock.calls[2][1]).toEqual(first);expect(host.textContent).toContain('已收藏');expect(onSaved).toHaveBeenCalledWith(result,first);
});
it('ignores an old lookup after switching positions',async()=>{
 let finish!:(value:unknown)=>void;api.mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValueOnce({bookmark:null});
 await act(async()=>root.render(<BookmarkAction entryId="entry" revisionId="rev" anchor={anchor} onSaved={()=>{}}/>));await act(async()=>root.render(<BookmarkAction entryId="entry" revisionId="rev" anchor={{...anchor,blockId:'new'}} onSaved={()=>{}}/>));await act(async()=>finish({bookmark:b}));expect(host.querySelector('button')?.disabled).toBe(false);expect(host.textContent).toBe('收藏');
});
it('does not let a late old list replace a refreshed deleted state',async()=>{
 let finish!:(value:unknown)=>void;api.mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValueOnce({bookmarks:[],total:0,revision:2,warnings:[]});
 await act(async()=>root.render(<BookmarksView version={0} onClose={()=>{}} onLocate={async()=>{}}/>));await act(async()=>vi.advanceTimersByTimeAsync(1));await act(async()=>root.render(<BookmarksView version={1} onClose={()=>{}} onLocate={async()=>{}}/>));await act(async()=>vi.advanceTimersByTimeAsync(1));await act(async()=>finish({bookmarks:[b],total:1,revision:1,warnings:[]}));expect(host.textContent).toContain('还没有收藏');expect(host.textContent).not.toContain('Safe title');
});
it('retains the complete snapshot when location fails and deletes only after explicit confirmation',async()=>{
 api.mockResolvedValue({bookmarks:[b],total:1,revision:1,warnings:[]});await act(async()=>root.render(<BookmarksView version={0} onClose={()=>{}} onLocate={async bookmark=>{expect(bookmark.revisionId).toBe('rev');throw new Error('version unavailable');}}/>));await act(async()=>vi.advanceTimersByTimeAsync(1));expect(host.querySelector('.bookmark-version')).toBeNull();expect(host.textContent).not.toContain('原文版本');expect(host.querySelector('.bookmark-card-actions button')?.textContent).toBe('定位原文');expect(host.querySelector('.bookmark-card-actions button')?.getAttribute('aria-label')).toBe('定位原文');await click('.bookmark-card-actions button');expect(host.textContent).toContain('version unavailable');expect(host.textContent).toContain(b.excerpt);await click('.bookmark-card-actions button:nth-child(2)');expect(api).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('确认删除');
});

// Uses the same parent feedback hook and real selection component wiring as App.
import {useState} from 'react';
import {useBookmarkFeedback} from './useBookmarkFeedback';
function ParentFeedbackHarness(){
 const feedback=useBookmarkFeedback();const [selection,setSelection]=useState<'A'|'B'|null>('A');
 return <><button data-select="A" onClick={()=>setSelection('A')}>Select A</button><button data-select="B" onClick={()=>setSelection('B')}>Select B</button><button data-close onClick={()=>setSelection(null)}>Close selection</button>{selection?<BookmarkAction entryId="entry" revisionId="rev" anchor={{...anchor,blockId:selection,quote:selection}} version={feedback.version} onStarted={feedback.started} onSaved={feedback.saved} onFailed={feedback.failed}/>:null}<output data-failure>{feedback.failure?`${feedback.failure.request.anchor.quote}:${feedback.failure.error}`:'no failure'}</output><button data-retry disabled={feedback.retrying} onClick={()=>void feedback.retry()}>Retry preserved failure</button><output data-notice>{feedback.notice?.bookmark.id??''}</output></>;
}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
it.each(['success','failure'] as const)('preserves B after selection closes when an older A save finishes with %s',async outcome=>{
 const old=deferred<BookmarkResult>();const requests:any[]=[];
 api.mockImplementation((path,request)=>{if(path.endsWith('/lookup'))return Promise.resolve({bookmark:null});requests.push(request);if(request.anchor.quote==='A')return old.promise;if(requests.filter(r=>r.anchor.quote==='B').length===1)return Promise.reject(new Error('B save failed'));return Promise.resolve({...result,created:false,bookmark:{...b,creationOperationId:'unrelated-original-creation'}});});
 await act(async()=>root.render(<ParentFeedbackHarness/>));await click('.bookmark-action button');await click('[data-select="B"]');await click('.bookmark-action button');expect(host.querySelector('[data-failure]')?.textContent).toBe('B:B save failed');await click('[data-close]');
 await act(async()=>{if(outcome==='success')old.resolve(result);else old.reject(new Error('A failed late'));});
 expect(host.querySelector('[data-failure]')?.textContent).toBe('B:B save failed');expect(host.querySelector('[data-notice]')?.textContent).toBe('');await click('[data-retry]');expect(requests[2].operationId).toBe(requests[1].operationId);expect(host.querySelector('[data-failure]')?.textContent).toBe('no failure');
});
it.each(['success','failure'] as const)('isolates a pending A retry ending in %s from a newer B failure',async outcome=>{
 const retry=deferred<BookmarkResult>();const requests:any[]=[];
 api.mockImplementation((path,request)=>{if(path.endsWith('/lookup'))return Promise.resolve({bookmark:null});requests.push(request);if(request.anchor.quote==='B')return Promise.reject(new Error('B save failed'));if(requests.filter(r=>r.anchor.quote==='A').length===1)return Promise.reject(new Error('A initial failed'));return retry.promise;});
 await act(async()=>root.render(<ParentFeedbackHarness/>));await click('.bookmark-action button');await click('[data-retry]');await click('[data-select="B"]');await click('.bookmark-action button');expect(host.querySelector('[data-failure]')?.textContent).toBe('B:B save failed');await click('[data-close]');
 await act(async()=>{if(outcome==='success')retry.resolve(result);else retry.reject(new Error('A retry failed late'));});
 expect(host.querySelector('[data-failure]')?.textContent).toBe('B:B save failed');expect(host.querySelector('[data-notice]')?.textContent).toBe('');expect(requests[0].operationId).toBe(requests[1].operationId);expect(host.querySelector<HTMLButtonElement>('[data-retry]')?.disabled).toBe(false);
});

it('shows the entire excerpt once with direct context and a named icon-only return',async()=>{
 const excerpt='A long complete saved excerpt\n'.repeat(12)+'END OF EXCERPT';
 api.mockResolvedValue({bookmarks:[{...b,excerpt,contextBefore:'Before context '+excerpt,contextAfter:excerpt+' After context'}],total:1,revision:1,warnings:[]});const close=vi.fn();await act(async()=>root.render(<BookmarksView version={0} onClose={close} onLocate={async()=>{}}/>));await act(async()=>vi.advanceTimersByTimeAsync(1));
 expect(host.querySelector('details')).toBeNull();expect(host.querySelector('.bookmark-excerpt')?.textContent).toBe(excerpt);expect(host.textContent?.split(excerpt)).toHaveLength(2);expect(host.querySelector('.bookmark-full')?.textContent).toBe('前文Before context '+excerpt+'后文 After context');const back=host.querySelector<HTMLButtonElement>('.bookmark-back')!;expect(back.textContent).toBe('');expect(back.getAttribute('aria-label')).toBe('返回阅读');expect(back.title).toBe('返回阅读');back.focus();expect(document.activeElement).toBe(back);await click('.bookmark-back');expect(close).toHaveBeenCalledOnce();expect(host.querySelector('.bookmark-delete')?.querySelector('.lucide-trash-2')).not.toBeNull();
});
