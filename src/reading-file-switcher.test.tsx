import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReadingLibraryNavigation } from './ReadingLibraryView';
import type { useReadingLibrary } from './useReadingLibrary';

it('keeps ten files in a dismissible popup with stable ordering across switches', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const entries = Array.from({length:10}, (_,i)=>({id:String(i), filename:`文章${i+1}.md`,path:`/test/${i}.md`}));
  const open=vi.fn(), choose=vi.fn();
  const library={recoveries:[],ready:true,list:{entries:[...entries].reverse(),warnings:[],nativePicker:true},entry:{id:'0',workspace:{document:{filename:'文章1.md'}}},open,choose} as unknown as ReturnType<typeof useReadingLibrary>;
  const render=()=>root.render(<ReadingLibraryNavigation library={library} importCopy={vi.fn()} />);
  await act(async()=>render());
  expect(host.querySelector('.library-items')).toBeNull();
  const trigger=host.querySelector<HTMLButtonElement>('.library-current')!;
  await act(async()=>trigger.click());
  const writeText=vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText}});
  await act(async()=>(host.querySelector('.library-copy-path') as HTMLButtonElement).click());
  expect(writeText).toHaveBeenCalledWith('/test/0.md');
  expect(host.textContent).toContain('路径已复制');
  expect(open).not.toHaveBeenCalled();
  writeText.mockRejectedValueOnce(new Error('denied'));
  await act(async()=>(host.querySelectorAll('.library-copy-path')[1] as HTMLButtonElement).click());
  expect(host.textContent).toContain('复制失败，请选中路径手动复制');
  const order=()=>[...host.querySelectorAll('.library-open')].map(e=>e.textContent);
  expect(order()).toEqual(entries.map(e=>e.filename));
  expect(host.querySelector('.library-path-tip')).toBeNull();expect(host.querySelector('.library-current')?.getAttribute('title')).toBe('文章1.md');
  await act(async()=>(host.querySelectorAll('.library-open')[2] as HTMLElement).click());
  expect(open).toHaveBeenCalledWith('2');expect(host.querySelector('.library-items')).toBeNull();
  library.list.entries.reverse();
  await act(async()=>render());await act(async()=>trigger.click());
  expect(order()).toEqual(entries.map(e=>e.filename));
  await act(async()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(host.querySelector('.library-items')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await act(async()=>root.unmount());host.remove();
});

it('offers a single add menu and independent source copying/open-original actions',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);const choose=vi.fn(),showWebImport=vi.fn(),open=vi.fn();const library={recoveries:[],ready:true,list:{entries:[{id:'web',filename:'网页',kind:'web',url:'https://claude.dev/article',importedAt:'2026-10-10'}],warnings:[],nativePicker:true},entry:null,choose,showWebImport,open}as unknown as ReturnType<typeof useReadingLibrary>;
 await act(async()=>root.render(<ReadingLibraryNavigation library={library} importCopy={vi.fn()}/>));expect(host.querySelector('.library-add-link')).toBeNull();const add=host.querySelector<HTMLButtonElement>('.library-add')!;expect(add.textContent).toBe('');expect(add.querySelector('svg')?.getAttribute('width')).toBe('18');expect(add.querySelector('svg')?.getAttribute('stroke-width')).toBe('2');expect(add.getAttribute('aria-label')).toBe('添加阅读材料');expect(add.hasAttribute('title')).toBe(false);expect(add.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');await act(async()=>add.click());expect([...host.querySelectorAll('[role=menuitem]')].map(e=>e.querySelector('span')?.textContent)).toEqual(['本地文件','网页链接']);await act(async()=>host.querySelector<HTMLElement>('[role=menuitem]')!.click());expect(choose).toHaveBeenCalledOnce();await act(async()=>add.click());await act(async()=>(host.querySelectorAll<HTMLElement>('[role=menuitem]')[1]).click());expect(showWebImport).toHaveBeenCalledOnce();await act(async()=>add.click());await act(async()=>add.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(host.querySelector('[role=menu]')).toBeNull();expect(document.activeElement).toBe(add);
 await act(async()=>host.querySelector<HTMLButtonElement>('.library-current')!.click());const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});await act(async()=>host.querySelector<HTMLButtonElement>('.library-copy-url')!.click());expect(copy).toHaveBeenCalledWith('https://claude.dev/article');expect(open).not.toHaveBeenCalled();expect(host.querySelector('a')?.getAttribute('href')).toBe('https://claude.dev/article');expect(host.querySelector('a')?.textContent).toBe('https://claude.dev/article');expect(host.textContent).not.toContain('打开原网页');expect(host.textContent).not.toContain('导入于');copy.mockRejectedValueOnce(Error('denied'));await act(async()=>host.querySelector<HTMLButtonElement>('.library-copy-url')!.click());expect(host.textContent).toContain('复制失败，请选中链接手动复制');expect(open).not.toHaveBeenCalled();await act(async()=>root.unmount());host.remove();
});

it('filters without opening, keeps keyboard focus and resets the query when dismissed',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),open=vi.fn();
 const library={recoveries:[],ready:true,list:{entries:[{id:'a',filename:'报告.md',path:'/files/a.md'},{id:'b',filename:'Plan2.pdf',path:'/files/b.pdf'},{id:'c',filename:'Plan10.md',path:'/files/c.md'}],warnings:[]},entry:{id:'a',workspace:{document:{filename:'报告.md'}}},open} as unknown as ReturnType<typeof useReadingLibrary>;
 await act(async()=>root.render(<ReadingLibraryNavigation library={library} importCopy={vi.fn()}/>));
 const trigger=host.querySelector<HTMLButtonElement>('.library-current')!;
 await act(async()=>trigger.click());
 const input=host.querySelector<HTMLInputElement>('input[type=search]')!;
 const fill=async(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
 await fill('pLaN');expect([...host.querySelectorAll('.library-open')].map(e=>e.textContent)).toEqual(['Plan2.pdf','Plan10.md']);
 expect(open).not.toHaveBeenCalled();expect(trigger.textContent).toContain('报告.md');expect(host.querySelector('[aria-current=page]')).toBeNull();
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
 expect(document.activeElement?.textContent).toBe('Plan2.pdf');
 await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
 expect(document.activeElement?.textContent).toBe('Plan10.md');
 await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})));
 expect(document.activeElement?.textContent).toBe('Plan2.pdf');
 await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})));
 expect(document.activeElement).toBe(input);
 await fill('不存在');expect(host.textContent).toContain('没有匹配的文件名称');expect(host.querySelector('.library-open')).toBeNull();
 expect(host.querySelector('[aria-label="清除名称搜索"]')).toBeNull();await act(async()=>input.focus());await fill('');expect(input.value).toBe('');expect(host.querySelectorAll('.library-open')).toHaveLength(3);expect(document.activeElement).toBe(input);
 await fill('plan');await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(host.querySelector('.library-popup')).toBeNull();expect(document.activeElement).toBe(trigger);
 await act(async()=>trigger.click());expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('');expect(host.querySelectorAll('.library-open')).toHaveLength(3);
 await act(async()=>host.querySelector<HTMLButtonElement>('.library-open')!.click());expect(open).toHaveBeenCalledOnce();
 await act(async()=>root.unmount());host.remove();
});

 it('opens add menu on hover or keyboard focus, keeps the union region open and closes after leaving or Escape',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
 const library={ready:true,busy:false,recoveries:[],list:{entries:[],warnings:[],nativePicker:true},entry:null} as unknown as ReturnType<typeof useReadingLibrary>;
 await act(async()=>root.render(<ReadingLibraryNavigation library={library} importCopy={vi.fn()}/>));const holder=host.querySelector<HTMLElement>('.library-add-menu')!,trigger=host.querySelector<HTMLButtonElement>('.library-add')!;
 await act(async()=>holder.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));expect(host.querySelector('[role=menu]')).not.toBeNull();expect(host.querySelectorAll('[role=menuitem] small')[0]?.textContent).toBe('MD / PDF');expect(host.querySelectorAll('[role=menuitem] small')[1]?.textContent).toBe('静态文章 / X');
 const item=host.querySelector<HTMLElement>('[role=menuitem]')!;await act(async()=>trigger.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:item})));expect(host.querySelector('[role=menu]')).not.toBeNull();
 await act(async()=>holder.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body})));expect(host.querySelector('[role=menu]')).toBeNull();
 await act(async()=>trigger.focus());expect(host.querySelector('[role=menu]')).not.toBeNull();await act(async()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(host.querySelector('[role=menu]')).toBeNull();expect(document.activeElement).toBe(trigger);
 await act(async()=>trigger.click());expect(host.querySelector('[role=menu]')).not.toBeNull();const staleItem=host.querySelector<HTMLButtonElement>('[role=menuitem]')!;library.busy=true;await act(async()=>root.render(<ReadingLibraryNavigation library={library} importCopy={vi.fn()}/>));expect(host.querySelector('[role=menu]')).toBeNull();expect(trigger.disabled).toBe(true);await act(async()=>staleItem.click());
 library.ready=false;await act(async()=>root.render(<ReadingLibraryNavigation library={library} importCopy={vi.fn()}/>));await act(async()=>holder.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));expect(host.querySelector('[role=menu]')).toBeNull();
 await act(async()=>root.unmount());host.remove();
});
