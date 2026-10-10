import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useResponsiveDrawer } from './useResponsiveDrawer';
let host: HTMLDivElement, root: Root, drawer: ReturnType<typeof useResponsiveDrawer>;
function Harness({ narrow, expanded = false }: { narrow: boolean; expanded?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  drawer = useResponsiveDrawer({ narrow, desktopExpanded: expanded, panel, desktopTrigger: '#edge', desktopControl: '#pin' });
  return <><button id="edge">边缘入口</button><button id="header" ref={drawer.triggerRef}>页头入口</button><aside ref={panel}><button id="pin">固定</button><input defaultValue="未发送草稿"/></aside><button id="outside">正文</button></>;
}
const render = async (narrow: boolean, expanded = false) => act(async () => root.render(<Harness narrow={narrow} expanded={expanded}/>));
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host=document.createElement('div');document.body.append(host);root=createRoot(host); });
afterEach(async () => { await act(async () => root.unmount());host.remove(); });
it('clears only temporary open state across modes and preserves the mounted draft', async () => {
  await render(true);await act(async () => drawer.setOpen(true));
  const input=host.querySelector('input')!;input.value='跨模式仍保留';input.focus();
  await render(false);expect(drawer.open).toBe(false);expect(document.activeElement?.id).toBe('edge');
  await render(true);expect(drawer.open).toBe(false);expect(input.value).toBe('跨模式仍保留');expect(document.activeElement?.id).toBe('header');
});
it('keeps focus inside a desktop panel that remains expanded', async () => {
  await render(true);await act(async () => drawer.setOpen(true));host.querySelector('input')!.focus();
  await render(false,true);expect(document.activeElement).toBe(host.querySelector('input'));expect(drawer.open).toBe(false);
  await render(true,true);expect(document.activeElement?.id).toBe('header');
});
it('moves focus from a disappearing header trigger to the visible pinned-panel control', async () => {
  await render(true);host.querySelector<HTMLButtonElement>('#header')!.focus();
  await render(false,true);expect(document.activeElement?.id).toBe('pin');
});
it('restores focus on explicit close and backdrop close without stealing unrelated focus', async () => {
  await render(true);await act(async () => drawer.setOpen(true));host.querySelector('input')!.focus();
  await act(async () => drawer.close());expect(drawer.open).toBe(false);expect(document.activeElement?.id).toBe('header');
  await act(async () => drawer.setOpen(true));host.querySelector<HTMLButtonElement>('#outside')!.focus();
  await act(async () => drawer.close(true));expect(document.activeElement?.id).toBe('header');
  host.querySelector<HTMLButtonElement>('#outside')!.focus();await render(false);expect(document.activeElement?.id).toBe('outside');
});
it('does not close or move focus when only desktop expansion changes within the same mode', async () => {
  await render(true);await act(async () => drawer.setOpen(true));host.querySelector('input')!.focus();
  await render(true,true);expect(drawer.open).toBe(true);expect(document.activeElement).toBe(host.querySelector('input'));
});

it('recovers focus if CSS blurs a hidden drawer before the media update arrives', async () => {
  await render(true);await act(async () => drawer.setOpen(true));const input=host.querySelector('input')!;
  input.focus();input.blur();expect(document.activeElement).toBe(document.body);
  await render(false);expect(document.activeElement?.id).toBe('edge');
});

it('cycles keyboard focus inside an open drawer and redirects programmatic background focus', async () => {
 await render(true);await act(async()=>drawer.setOpen(true));
 expect(document.activeElement?.id).toBe('pin');
 host.querySelector('input')!.focus();
 await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
 expect(document.activeElement?.id).toBe('pin');
 await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));
 expect(document.activeElement).toBe(host.querySelector('input'));
 host.querySelector<HTMLButtonElement>('#outside')!.focus();expect(document.activeElement?.id).toBe('pin');
});
