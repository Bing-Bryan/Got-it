import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
vi.mock('./lib/runtime-mode', () => ({HOSTED:true, trialId:()=> 'trial', hostedCapabilities:vi.fn()}));
import {WebTranslationControls} from './WebTranslationControls';
import {webWorkspace} from './test-support/web';
import type {useReadingLibrary} from './useReadingLibrary';

it('keeps the old short authorization copy and collapses hosted send/storage details', async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),workspace=webWorkspace();
  const library={status:'已保存到当前浏览器',ready:true,readOnly:false,autoTranslate:false,translationRunning:false,translationProgress:'',translate:vi.fn(),stopTranslation:vi.fn(),setAutoTranslation:vi.fn()} as unknown as ReturnType<typeof useReadingLibrary>;
  try {
    await act(async()=>root.render(<WebTranslationControls workspace={workspace} library={library} onSide={()=>{}}/>));
    await act(async()=>host.querySelector<HTMLButtonElement>('.translation-side-toggle')!.click());
    const panel=host.querySelector<HTMLElement>('.translation-permission')!;
    const main=panel.querySelector('p')!;
    expect(main.textContent).toContain('将全部可翻译正文分批发送给当前 AI，生成中文译文。');
    expect(main.textContent).toContain('代码、URL和图片不发送，原文保留。');
    expect(main.textContent).not.toContain('服务端不持久保存正文或译文');
    expect(panel.textContent).toContain('以后自动翻译确认加入的新英文网页');
    expect(panel.querySelector('details')?.open).toBe(false);
    const details=panel.querySelector<HTMLDetailsElement>('details')!;
    await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    expect(details.textContent).toContain('发送与存储说明');
    expect(details.textContent).toContain('每批使用体验额度');
    expect(details.textContent).toContain('服务端不持久保存正文或译文');
    expect(library.translate).not.toHaveBeenCalled();
  } finally {
    await act(async()=>root.unmount());
    host.remove();
  }
});
