import {act, StrictMode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({request:vi.fn(), generate:vi.fn()}));
vi.mock('./lib/library-client', async importOriginal => ({...await importOriginal<typeof import('./lib/library-client')>(), libraryRequest:mocks.request}));
vi.mock('./lib/generate-pdf-outline', () => ({generatePdfOutline:mocks.generate}));
import {LibraryClientError} from './lib/library-client';
import PdfOutline from './PdfOutline';
const hash = 'a'.repeat(64);
const item = {id:'one', title:'原文标题', page:2, top:.1, level:1, source:'ocr'};
const empty = {version:1, fileHash:hash, revision:0, reviewed:false, items:[]};
const saved = {...empty, revision:1, items:[item]};
let root:Root, host:HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.request.mockReset(); mocks.generate.mockReset();
  mocks.request.mockImplementation((_path, body) => Promise.resolve(body ? {...body, revision:1} : empty));
  mocks.generate.mockResolvedValue([item]);
});
afterEach(async () => {await act(async () => root.unmount()); host.remove();});
const render = async (jump=vi.fn(), entryId='id', readOnly=false) => {
  await act(async () => root.render(<PdfOutline entryId={entryId} fileHash={hash} pages={3} currentPage={2} readOnly={readOnly} onJump={jump}/>));
};
const click = async (text:string) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === text);
  expect(button).toBeTruthy(); await act(async () => button!.click());
};
const writes = () => mocks.request.mock.calls.filter(call => call[1] !== undefined);
const noManagement = () => {
  for (const label of ['生成原文目录', '重新识别', '核对目录', '保存目录', '待核对', '核对完成']) expect(host.textContent).not.toContain(label);
  expect(host.querySelector('input,select,fieldset')).toBeNull();
};
it('automatically generates and saves a missing outline, without management buttons', async () => {
  await render(); expect(mocks.generate).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(1);
  expect(host.textContent).toContain('原文标题'); noManagement();
  await render(); expect(mocks.generate).toHaveBeenCalledTimes(1);
});
it('loads existing manual titles without OCR, preserves all titles, highlighting and repeated navigation', async () => {
  mocks.request.mockResolvedValue({...saved, reviewed:true, items:[{...item, source:'manual'}, {...item,id:'two',title:'另一章节',page:3,source:'manual'}]});
  const jump=vi.fn(); await render(jump); await click('原文标题2'); await click('原文标题2');
  expect(jump).toHaveBeenCalledTimes(2); expect(host.querySelector('[aria-current=location]')).not.toBeNull();
  expect(mocks.generate).not.toHaveBeenCalled(); noManagement(); expect(host.querySelectorAll('.outline-item')).toHaveLength(2); await click('另一章节3'); expect(jump.mock.lastCall?.[0]).toMatchObject({id:'two',page:3});
});
it('shows progress while generating and no premature success or retry action', async () => {
  let resolve!:(value:unknown)=>void;
  mocks.generate.mockImplementation((_id,_hash,_signal,progress) => {progress('正在本机识别目录 · 1 / 3 页'); return new Promise(r => resolve=r);});
  await render(); expect(host.textContent).toContain('1 / 3 页'); expect(host.querySelector('button')).toBeNull();
  await act(async () => resolve([item])); noManagement(); expect(writes()).toHaveLength(1);
});
it('only offers recognition retry on failure and succeeds without a persistent retry button', async () => {
  mocks.generate.mockRejectedValueOnce(new Error('识别超时')); await render();
  expect(host.textContent).toContain('识别超时'); expect(writes()).toHaveLength(0);
  await render(); expect(mocks.generate).toHaveBeenCalledTimes(1);
  await click('重新识别'); expect(mocks.generate).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(1); noManagement();
});
it('treats empty recognition as unsuccessful and does not save a false success', async () => {
  mocks.generate.mockResolvedValue([]); await render(); expect(host.textContent).toContain('未识别到可用');
  expect(host.textContent).toContain('重新识别'); expect(writes()).toHaveLength(0);
});
it('retries saving candidates without rerunning recognition or offering a manual save workflow', async () => {
  mocks.request.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('磁盘不可用')).mockResolvedValue(saved);
  await render(); expect(host.textContent).toContain('暂未保存'); expect(host.textContent).toContain('原文标题');
  expect(host.textContent).not.toContain('重新识别'); expect(host.textContent).not.toContain('保存目录');
  await click('重试'); expect(mocks.generate).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(2); expect(host.querySelector('[role=alert]')).toBeNull();
});
it('does not generate after a read failure; retry safely loads an existing outline', async () => {
  mocks.request.mockRejectedValueOnce(new Error('读取不可用')).mockResolvedValue(saved);
  await render(); expect(mocks.generate).not.toHaveBeenCalled(); await click('重新载入目录');
  expect(host.textContent).toContain('原文标题'); expect(mocks.generate).not.toHaveBeenCalled(); noManagement();
});
it('resolves a save conflict by loading the other version, never overwriting it blindly', async () => {
  mocks.request.mockResolvedValueOnce(empty).mockRejectedValueOnce(new LibraryClientError('conflict',409))
    .mockResolvedValue({...saved, items:[{...item,title:'另一页面的标题'}]});
  await render(); expect(host.textContent).toContain('另一页面已更新'); await click('重新载入目录');
  expect(host.textContent).toContain('另一页面的标题'); expect(writes()).toHaveLength(1);
});
it('does not generate or save an empty read-only document', async () => {
  await render(vi.fn(),'id',true); expect(mocks.generate).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  expect(host.textContent).toContain('只读'); expect(host.querySelector('button')).toBeNull();
});
it('ignores a late load when the document changes, even without a React key', async () => {
  let resolve!:(value:unknown)=>void;
  mocks.request.mockImplementationOnce(() => new Promise(r => resolve=r)).mockResolvedValue(saved);
  await render(); await render(vi.fn(),'other'); await act(async () => resolve(empty));
  expect(mocks.generate).not.toHaveBeenCalled(); expect(host.textContent).toContain('原文标题');
});
it('aborts a generation after switching away and never saves its late result', async () => {
  let resolve!:(value:unknown)=>void;
  mocks.generate.mockImplementation(() => new Promise(r => resolve=r)); await render();
  const signal=mocks.generate.mock.calls[0][2]; await act(async () => root.render(<div>其他文档</div>));
  expect(signal.aborted).toBe(true); await act(async () => resolve([item])); expect(writes()).toHaveLength(0);
});
it('ignores a late save response after switching to a different document', async () => {
  let resolve!:(value:unknown)=>void;
  mocks.request.mockResolvedValueOnce(empty).mockImplementationOnce(() => new Promise(r => resolve=r))
    .mockResolvedValue({...saved, items:[{...item,title:'新文档标题'}]});
  await render(); await render(vi.fn(),'other'); await act(async () => resolve(saved));
  expect(host.textContent).toContain('新文档标题'); expect(host.textContent).not.toContain('原文标题');
});
it('does not start duplicate OCR under StrictMode effect replay', async () => {
  await act(async () => root.render(<StrictMode><PdfOutline entryId="id" fileHash={hash} pages={3} currentPage={1} onJump={vi.fn()}/></StrictMode>));
  expect(mocks.generate).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(1); noManagement();
});
