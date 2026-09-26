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
