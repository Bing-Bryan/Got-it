import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReadingLibraryStatus } from './ReadingLibraryView';
import type { useReadingLibrary } from './useReadingLibrary';
import type { SourceStatus } from './lib/library-types';

it.each(['available', 'missing', 'permission', 'unreadable', 'reselect', 'unlinked', 'changed'] as SourceStatus[])('shows only relevant source actions for %s', async status => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  const retry = vi.fn(), choose = vi.fn(), update = vi.fn();
  const library = { recoveries:[], entry: { source: status === 'unlinked' ? null : {}, history: [] }, list: { nativePicker: true }, check: { status, message: '来源状态' }, checkSource: retry, choose, acceptUpdate: update } as unknown as ReturnType<typeof useReadingLibrary>;
  await act(async () => root.render(<ReadingLibraryStatus library={library} />));
  if (status === 'available') expect(host.textContent).toBe('');
  else {
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map(b => b.textContent)).toEqual(status === 'changed' ? ['使用更新后的原文'] : status === 'unlinked' ? ['关联原文件'] : ['重试读取', '重新定位']);
    await act(async () => buttons[0].click());
    expect(status === 'changed' ? update : status === 'unlinked' ? choose : retry).toHaveBeenCalledOnce();
  }
  await act(async () => root.unmount());
});

it('offers file selection after import failure but preserves save retry when navigation is blocked', async () => {
 const host=document.createElement('div'),root=createRoot(host),onImport=vi.fn(),retry=vi.fn();
 const library={ready:true,recoveries:[],list:{nativePicker:false},error:'文件损坏',importError:true,retry} as unknown as ReturnType<typeof useReadingLibrary>;
 await act(async()=>root.render(<ReadingLibraryStatus library={library} onImport={onImport}/>));
 expect(host.textContent).toContain('重新选择文件');expect(host.textContent).not.toContain('重试保存');
 await act(async()=>host.querySelector('button')!.click());expect(onImport).toHaveBeenCalledOnce();expect(retry).not.toHaveBeenCalled();
 await act(async()=>root.render(<ReadingLibraryStatus library={{...library,blocked:true}} onImport={onImport}/>));
 expect(host.textContent).toContain('保存成功后才能离开');await act(async()=>host.querySelector('button')!.click());expect(retry).toHaveBeenCalledOnce();
 await act(async()=>root.unmount());
});
