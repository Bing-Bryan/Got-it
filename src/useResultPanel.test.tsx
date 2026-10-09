import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { useResultPanel } from './useResultPanel';
let panel: ReturnType<typeof useResultPanel>, root: Root, host: HTMLDivElement;
let media: {matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>};
const key = 'got-it.result-panel-pinned.v1';
function Harness() {
  panel = useResultPanel();
  return <><button ref={panel.triggerRef}>展开</button><aside ref={panel.ref} inert={!panel.expanded}><button>内部控件</button></aside></>;
}
async function mount() { await act(async () => root.render(<Harness/>)); }
async function tick() { await act(async () => vi.advanceTimersByTime(250)); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); vi.useFakeTimers();
  media = {matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()};
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0));
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('defaults pinned and restores an independent preference without changing the left key', async () => {
  localStorage.setItem('got-it.sidebar-pinned.v1','false'); await mount();
  expect(panel.pinned).toBe(true);
  await act(async () => panel.pin(false)); await tick();
  expect(panel.expanded).toBe(false); expect(localStorage.getItem(key)).toBe('false');
  await act(async () => root.unmount()); root=createRoot(host); await mount();
  expect(panel.pinned).toBe(false); expect(localStorage.getItem('got-it.sidebar-pinned.v1')).toBe('false');
});
it('keeps session controls usable when storage is unavailable', async () => {
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(() => {throw new Error('blocked');});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new Error('blocked');});
  await mount(); expect(panel.pinned).toBe(true);
  await act(async () => panel.pin(false)); await tick(); expect(panel.expanded).toBe(false);
});
it('delays transient closure and cancels it on reentry or internal focus', async () => {
  localStorage.setItem(key,'false'); await mount();
  await act(async () => { panel.reveal(); panel.leave(); });
  await act(async () => vi.advanceTimersByTime(100)); expect(panel.expanded).toBe(true);
  await act(async () => panel.enter()); await tick(); expect(panel.expanded).toBe(true);
  host.querySelector('aside button')!.dispatchEvent(new Event('focus'));
  (host.querySelector('aside button') as HTMLButtonElement).focus();
  await act(async () => panel.leave()); await tick(); expect(panel.expanded).toBe(true);
  (host.querySelector('aside button') as HTMLButtonElement).blur();
  await act(async () => panel.deferClose()); await tick(); expect(panel.expanded).toBe(false);
});
it('retains intentionally opened results on leave and explicitly closes with focus restoration', async () => {
  localStorage.setItem(key,'false'); await mount();
  await act(async () => { panel.openReading(); panel.leave(); }); await tick(); expect(panel.expanded).toBe(true);
  (host.querySelector('aside button') as HTMLButtonElement).focus();
  await act(async () => panel.close()); await tick();
  expect(panel.expanded).toBe(false); expect(document.activeElement).toBe(panel.triggerRef.current);
});
it('pinning cancels a pending hide; Escape does not hide a pinned panel', async () => {
  localStorage.setItem(key,'false'); await mount();
  await act(async () => { panel.reveal(); panel.leave(); panel.pin(true); }); await tick();
  await act(async () => panel.close()); expect(panel.expanded).toBe(true);
});
it('breakpoint changes clear transient state but retain desktop preference', async () => {
  localStorage.setItem(key,'false'); await mount();
  await act(async () => panel.openReading());
  await act(async () => {media.matches=true; media.addEventListener.mock.calls[0][1]();});
  expect(panel.narrow).toBe(true); expect(panel.expanded).toBe(false); expect(localStorage.getItem(key)).toBe('false');
  await act(async () => {media.matches=false; media.addEventListener.mock.calls[0][1]();});
  expect(panel.narrow).toBe(false); expect(panel.expanded).toBe(false);
});

it('does not reopen when a pointer close exposes the edge rail underneath', async () => {
  localStorage.setItem(key,'false'); await mount();
  await act(async () => panel.openReading());
  await act(async () => panel.close());
  await act(async () => panel.hoverReveal()); expect(panel.expanded).toBe(false);
  await act(async () => panel.reveal()); expect(panel.expanded).toBe(true);
  await act(async () => panel.close());
  await act(async () => vi.advanceTimersByTime(301));
  await act(async () => panel.hoverReveal()); expect(panel.expanded).toBe(true);
});
it('reconciles a viewport change before the media listener subscribes', async () => {
  vi.stubGlobal('matchMedia',vi.fn().mockReturnValueOnce({...media,matches:true}).mockReturnValue(media));
  await mount(); expect(panel.narrow).toBe(false); expect(panel.expanded).toBe(true);
});
