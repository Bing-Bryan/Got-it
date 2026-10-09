import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clampMarkdownWidth, MARKDOWN_WIDTH_KEY, useMarkdownWidth } from './useMarkdownWidth';
let host: HTMLDivElement, root: Root;
function Harness() {
 const article = useRef<HTMLElement>(null), control = useMarkdownWidth(article);
 return <><article ref={article}/><output>{control.width}</output><button onClick={()=>control.change(100)}>wide</button><button onClick={()=>control.change(80)}>reset</button><button onClick={()=>control.change(NaN)}>invalid</button></>;
}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.removeItem(MARKDOWN_WIDTH_KEY);host=document.createElement('div');root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());vi.restoreAllMocks();localStorage.removeItem(MARKDOWN_WIDTH_KEY);});
async function mount(){await act(async()=>root.render(<Harness/>));}
async function click(index:number){await act(async()=>host.querySelectorAll('button')[index].click());}
it('restores a valid preference and constrains values',async()=>{localStorage.setItem(MARKDOWN_WIDTH_KEY,'65');await mount();expect(host.querySelector('output')!.textContent).toBe('65');expect(clampMarkdownWidth(20)).toBe(50);expect(clampMarkdownWidth(140)).toBe(100);});
it('stores changes and resets without changing document data',async()=>{await mount();await click(0);expect(localStorage.getItem(MARKDOWN_WIDTH_KEY)).toBe('100');await click(1);expect(localStorage.getItem(MARKDOWN_WIDTH_KEY)).toBe('80');await click(2);expect(host.querySelector('output')!.textContent).toBe('80');});
it('ignores invalid storage and tolerates blocked writes',async()=>{localStorage.setItem(MARKDOWN_WIDTH_KEY,'broken');await mount();expect(host.querySelector('output')!.textContent).toBe('80');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});await click(0);expect(host.querySelector('output')!.textContent).toBe('100');});
