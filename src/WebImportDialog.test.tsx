import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import { WebImportDialog } from './WebImportDialog';
import type { useReadingLibrary } from './useReadingLibrary';

it('shows one adjacent reading action and one error, dismisses only actual backdrop interactions',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),cancel=vi.fn(),read=vi.fn();
 const library={webImportOpen:true,webError:'读取失败，请重试',webJob:{operationId:'op',status:'failed',progress:'读取失败，请重试'},busy:false,cancelWebImport:cancel,readWebArticle:read} as unknown as ReturnType<typeof useReadingLibrary>;
 await act(async()=>root.render(<WebImportDialog library={library}/>));const dialog=host.querySelector('dialog')!;dialog.getBoundingClientRect=()=>({left:100,right:400,top:100,bottom:300}as DOMRect);
 expect(host.querySelectorAll('button')).toHaveLength(1);expect(host.querySelector('button')?.textContent).toBe('阅读文章');expect(host.textContent?.match(/读取失败，请重试/g)).toHaveLength(1);expect(host.textContent).not.toContain('Claude 样本');expect(host.textContent).not.toContain('暂不加入');
 const input=host.querySelector('input')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'https://www.anthropic.com/research/article');input.dispatchEvent(new Event('input',{bubbles:true}));host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});expect(read).toHaveBeenCalledWith('https://www.anthropic.com/research/article');
 const click=async(downX:number,clickX:number)=>act(async()=>{dialog.dispatchEvent(new MouseEvent('pointerdown',{clientX:downX,clientY:150,bubbles:true}));dialog.dispatchEvent(new MouseEvent('click',{clientX:clickX,clientY:150,bubbles:true}));});
 await click(200,200);await click(200,20);expect(cancel).not.toHaveBeenCalled();await click(20,20);expect(cancel).toHaveBeenCalledWith(true);
 await act(async()=>dialog.dispatchEvent(new Event('cancel',{cancelable:true})));expect(cancel).toHaveBeenCalledTimes(2);
 await act(async()=>root.unmount());host.remove();
});
it('locks dismissal only during saving, shows saving state and returns focus after closing',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const trigger=document.body.appendChild(document.createElement('button'));trigger.focus();const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),cancel=vi.fn();const library={webImportOpen:true,busy:true,webError:'',webJob:{operationId:'op',status:'ready',progress:'正文已读'},cancelWebImport:cancel,readWebArticle:vi.fn()}as unknown as ReturnType<typeof useReadingLibrary>;
 await act(async()=>root.render(<WebImportDialog library={library}/>));const d=host.querySelector('dialog')!;await act(async()=>d.dispatchEvent(new Event('cancel',{cancelable:true})));expect(cancel).not.toHaveBeenCalled();expect(host.textContent).toContain('保存完成前暂不能关闭');expect(host.querySelector('button')?.disabled).toBe(true);library.webImportOpen=false;await act(async()=>root.render(<WebImportDialog library={library}/>));expect(document.activeElement).toBe(trigger);await act(async()=>root.unmount());host.remove();trigger.remove();
});
it('clears the URL only after actual opening succeeds, retaining failures and cancelled input',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);const library={webImportOpen:true,webImportSuccess:0,busy:false,webError:'',webJob:null,cancelWebImport:vi.fn(),readWebArticle:vi.fn()}as unknown as ReturnType<typeof useReadingLibrary>;
 await act(async()=>root.render(<WebImportDialog library={library}/>));const input=host.querySelector('input')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'https://example.com/article');input.dispatchEvent(new Event('input',{bubbles:true}));});
 library.webError='保存失败';await act(async()=>root.render(<WebImportDialog library={library}/>));expect(host.querySelector('input')?.value).toBe('https://example.com/article');
 library.webImportOpen=false;await act(async()=>root.render(<WebImportDialog library={library}/>));library.webImportOpen=true;await act(async()=>root.render(<WebImportDialog library={library}/>));expect(host.querySelector('input')?.value).toBe('https://example.com/article');
 library.webImportSuccess=1;library.webImportOpen=false;await act(async()=>root.render(<WebImportDialog library={library}/>));library.webImportOpen=true;library.webError='';await act(async()=>root.render(<WebImportDialog library={library}/>));expect(host.querySelector('input')?.value).toBe('');expect(host.querySelector('button')?.disabled).toBe(true);
 await act(async()=>root.unmount());host.remove();
});
