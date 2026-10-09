import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSaveStatus } from './useSaveStatus';
let root: Root, host: HTMLDivElement;
function Harness({status,identity}:{status:string;identity:string}) { return <span>{useSaveStatus(status,identity)}</span>; }
async function render(status:string,identity='pdf') { await act(async()=>root.render(<Harness status={status} identity={identity}/>)); }
async function tick(ms:number) { await act(async()=>vi.advanceTimersByTimeAsync(ms)); }
beforeEach(()=>{vi.useFakeTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();});
it('keeps saving visible through repeated fast saves until 800ms of quiet',async()=>{
 await render('已保存到本机');expect(host.textContent).toBe('已保存到本机');
 for(let i=0;i<4;i++) {
  await render('保存中…');expect(host.textContent).toBe('保存中');
  await render('已保存到本机');await tick(500);expect(host.textContent).toBe('保存中');
 }
 await tick(299);expect(host.textContent).toBe('保存中');
 await tick(1);expect(host.textContent).toBe('已保存到本机');
});
it('shows failures immediately and cancels pending success timers',async()=>{
 await render('保存中…');await render('已保存到本机');await tick(300);
 await render('阅读进度暂未保存');expect(host.textContent).toBe('阅读进度暂未保存');
 await tick(1000);expect(host.textContent).toBe('阅读进度暂未保存');
});
it('does not carry a previous document saving state across a switch',async()=>{
 await render('保存中…');await render('已保存到本机','markdown');
 expect(host.textContent).toBe('已保存到本机');
});
