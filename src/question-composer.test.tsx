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
 expect(document.activeElement).toBe(host.querySelector('textarea'));expect(host.querySelector('label')).toBeNull();expect(host.querySelectorAll('button')).toHaveLength(2);expect(host.querySelector<HTMLButtonElement>('[type=submit]')!.disabled).toBe(true);expect(host.querySelector('.question-back')?.textContent).toBe('返回');
 await type('  ');await key({key:'Enter'});expect(send).not.toHaveBeenCalled();
 await type('这个价格包含什么？');await key({key:'Escape'});expect(host.querySelector('textarea')).toBeNull();await click('.question-toggle');expect(host.querySelector('textarea')!.value).toBe('这个价格包含什么？');
 await click('[type=submit]');expect(send).toHaveBeenCalledExactlyOnceWith('这个价格包含什么？');
});
it.each([{inline:true},{inline:false},{inline:false,followUp:true}])('uses Enter to send and protects newline/IME in %j',async props=>{
 const send=vi.fn();await act(async()=>root.render(<QuestionComposer {...props} onSubmit={send}/>));await click('.question-toggle');await type('请说明原文');
 await key({key:'Enter',isComposing:true});await key({key:'Enter',keyCode:229});await key({key:'Enter',shiftKey:true});expect(send).not.toHaveBeenCalled();
 await key({key:'Enter'});expect(send).toHaveBeenCalledExactlyOnceWith('请说明原文');expect(host.querySelector('textarea')).toBeNull();
});
it('opens a document composer without sending, and closes its parent on Escape',async()=>{
 const send=vi.fn(),close=vi.fn();await act(async()=>root.render(<QuestionComposer initialOpen onSubmit={send} onClose={close}/>));expect(host.querySelector('textarea')).not.toBeNull();expect(send).not.toHaveBeenCalled();await key({key:'Escape'});expect(close).toHaveBeenCalledOnce();expect(send).not.toHaveBeenCalled();
});

it('returns from inline editing without sending or losing draft', async () => {
 const send=vi.fn();await act(async()=>root.render(<QuestionComposer inline onSubmit={send}/>));await click('.question-toggle');await type('保留这个问题');await click('.question-back');expect(send).not.toHaveBeenCalled();await click('.question-toggle');expect(host.querySelector('textarea')!.value).toBe('保留这个问题');
});
