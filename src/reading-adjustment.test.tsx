import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownWidthControls } from './MarkdownWidthControls';
import { PdfZoomControls } from './PdfZoomControls';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
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

const pointer = (node:Element,type:string,pointerType='mouse') => {
 const event=new MouseEvent(type,{bubbles:true});Object.defineProperty(event,'pointerType',{value:pointerType});node.dispatchEvent(event);
};
const tick=async()=>act(async()=>{vi.advanceTimersByTime(200);});
it.each(['markdown','pdf'])('%s hover survives travel and dragging but closes after ordinary leave or cancellation',async kind=>{
 vi.useFakeTimers();const change=vi.fn();await act(async()=>root.render(kind==='markdown'?<MarkdownWidthControls width={80} onChange={change}/>:<PdfZoomControls scale={1.2} automatic={false} onChange={change}/>));
 const wrapper=host.querySelector('.reading-adjustment')!,trigger=host.querySelector<HTMLButtonElement>('button')!,fields=host.querySelector<HTMLElement>('.reading-adjustment-fields')!;
 await act(async()=>pointer(trigger,'pointerover'));expect(fields.hidden).toBe(false);
 await act(async()=>pointer(wrapper,'pointerout'));await act(async()=>{vi.advanceTimersByTime(100);pointer(wrapper,'pointerover');});await tick();expect(fields.hidden).toBe(false);
 const slider=host.querySelector('input[type=range]')!;
 await act(async()=>{pointer(slider,'pointerdown');pointer(wrapper,'pointerout');});await tick();expect(fields.hidden).toBe(false);
 await act(async()=>pointer(document.body,'pointerup'));await tick();expect(fields.hidden).toBe(true);
 await act(async()=>pointer(trigger,'pointerover'));await act(async()=>{pointer(slider,'pointerdown');pointer(document.body,'pointercancel');});await tick();expect(fields.hidden).toBe(true);
 await act(async()=>pointer(trigger,'pointerover'));await act(async()=>pointer(wrapper,'pointerout'));await tick();expect(fields.hidden).toBe(true);
 expect(change).not.toHaveBeenCalled();
});
it.each(['markdown','pdf'])('%s supports touch toggle, mouse click after hover, editing and Escape without reopening',async kind=>{
 vi.useFakeTimers();await act(async()=>root.render(kind==='markdown'?<MarkdownWidthControls width={80} onChange={()=>{}}/>:<PdfZoomControls scale={1} automatic={true} onChange={()=>{}}/>));
 const trigger=host.querySelector<HTMLButtonElement>('button')!,wrapper=host.querySelector('.reading-adjustment')!,fields=host.querySelector<HTMLElement>('.reading-adjustment-fields')!;
 await act(async()=>{pointer(trigger,'pointerdown','touch');trigger.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));pointer(trigger,'pointerup','touch');});expect(fields.hidden).toBe(false);
 await act(async()=>{pointer(trigger,'pointerdown','touch');trigger.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));pointer(trigger,'pointerup','touch');});expect(fields.hidden).toBe(true);
 await act(async()=>{pointer(trigger,'pointerover');pointer(trigger,'pointerdown');trigger.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));pointer(trigger,'pointerup');});expect(fields.hidden).toBe(false);
 const input=host.querySelector<HTMLInputElement>('input[inputmode]')!;
 await act(async()=>{input.focus();pointer(wrapper,'pointerout');});await tick();expect(fields.hidden).toBe(false);
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));await tick();expect(fields.hidden).toBe(true);expect(document.activeElement).toBe(trigger);
 await act(async()=>trigger.click());expect(fields.hidden).toBe(false);
 await act(async()=>{trigger.blur();pointer(wrapper,'pointerout');});await tick();expect(fields.hidden).toBe(true);
 await act(async()=>{pointer(trigger,'pointerover');pointer(wrapper,'pointerout');root.render(null);});await tick();expect(host.children).toHaveLength(0);
});
