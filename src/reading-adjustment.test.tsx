import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownWidthControls } from './MarkdownWidthControls';
import { PdfZoomControls } from './PdfZoomControls';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it.each(['markdown','pdf'])('%s opens deliberately and Escape from percent input cancels without changing reading preference',async kind=>{
 const change=vi.fn();await act(async()=>root.render(kind==='markdown'?<MarkdownWidthControls width={80} onChange={change}/>:<PdfZoomControls scale={1.2} automatic={false} onChange={change}/>));
 const trigger=host.querySelector<HTMLButtonElement>('.reading-adjustment-trigger')!,fields=host.querySelector<HTMLElement>('.reading-adjustment-fields')!;
 expect(fields.hidden).toBe(true);await act(async()=>trigger.click());expect(fields.hidden).toBe(false);expect(change).not.toHaveBeenCalled();
 const input=host.querySelector<HTMLInputElement>('input[inputmode]')!;
 await act(async()=>{input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'90');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(fields.hidden).toBe(true);expect(document.activeElement).toBe(trigger);expect(change).not.toHaveBeenCalled();
 await act(async()=>trigger.click());await act(async()=>host.querySelector('input')!.dispatchEvent(new Event('pointerdown',{bubbles:true})));expect(fields.hidden).toBe(false);
 await act(async()=>document.body.dispatchEvent(new Event('pointerdown',{bubbles:true})));expect(fields.hidden).toBe(true);
});
