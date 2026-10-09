import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuestionComposer } from './QuestionComposer';
let root: Root, host: HTMLDivElement;
beforeEach(() => { host=document.createElement('div');document.body.append(host);root=createRoot(host); });
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const click=async(selector:string)=>{await act(async()=>host.querySelector<HTMLButtonElement>(selector)!.click());};
const type=async(text:string)=>{await act(async()=>{const el=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));});};
const key=async(init:KeyboardEventInit)=>{await act(async()=>host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{...init,bubbles:true,cancelable:true})));};
it('opens one focused inline field, disables blank send and preserves draft when escaping',async()=>{
 const send=vi.fn();await act(async()=>root.render(<QuestionComposer inline onSubmit={send}/>));await click('.question-toggle');
 expect(document.activeElement).toBe(host.querySelector('textarea'));expect(host.querySelector('label')).toBeNull();expect(host.querySelectorAll('button')).toHaveLength(1);expect(host.querySelector('button')!.disabled).toBe(true);
 await type('  ');await key({key:'Enter'});expect(send).not.toHaveBeenCalled();
 await type('这个价格包含什么？');await key({key:'Escape'});expect(host.querySelector('textarea')).toBeNull();await click('.question-toggle');expect(host.querySelector('textarea')!.value).toBe('这个价格包含什么？');
 await click('[type=submit]');expect(send).toHaveBeenCalledExactlyOnceWith('这个价格包含什么？');
});
it('does not send IME confirmation or Shift+Enter but sends a normal Enter once',async()=>{
 const send=vi.fn();await act(async()=>root.render(<QuestionComposer inline onSubmit={send}/>));await click('.question-toggle');await type('请说明原文');
 await key({key:'Enter',isComposing:true});await key({key:'Enter',keyCode:229});await key({key:'Enter',shiftKey:true});expect(send).not.toHaveBeenCalled();
 await key({key:'Enter'});expect(send).toHaveBeenCalledExactlyOnceWith('请说明原文');expect(host.querySelector('textarea')).toBeNull();
});
