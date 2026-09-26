import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { ReadingLibraryStatus,ReadingLibraryNavigation } from './ReadingLibraryView';
import type { useReadingLibrary } from './useReadingLibrary';
import { readingFixture,editReading } from './test-support/recovery-fixture';
import type { RecoveryRecord } from './lib/reading-recovery';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
function fixture(){
 const workspace=readingFixture();const r:RecoveryRecord={id:'recovery',entryId:'entry',createdAt:'2026-09-24',state:'pending',reason:'changed',previous:[],draft:{entryId:'entry',version:1,revisionId:'rev',workspace:editReading(workspace,'未保存的完整回答'),position:{ratio:0}},disk:{version:2,revisionId:'rev',workspace:editReading(workspace,'已保存的完整回答'),position:{ratio:0}}};
 return {ready:true,entry:{id:'entry',workspace,source:null,history:[]},list:{entries:[{id:'entry',filename:'测试.md'}],warnings:[],nativePicker:true},recoveries:[{id:r.id,entryId:'entry',state:'pending',filename:'测试.md'}],recovery:r,resolveRecovery:vi.fn(),showRecovery:vi.fn(),closeRecovery:vi.fn(),retry:vi.fn()} as unknown as ReturnType<typeof useReadingLibrary>;
}
it('shows concrete same-count differences, preserved-choice consequences, and keeps adding available',async()=>{
 const l=fixture();await act(async()=>root.render(<><ReadingLibraryNavigation library={l} importCopy={vi.fn()}/><ReadingLibraryStatus library={l}/></>));
 expect(host.textContent).toContain('未保存的完整回答');expect(host.textContent).toContain('已保存的完整回答');expect(host.textContent).toContain('另一份仍可回看');expect(host.textContent).toContain('未知');
 expect(host.textContent).not.toContain('恢复并保存缓存');expect(host.querySelector<HTMLButtonElement>('.library-add')!.disabled).toBe(false);
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='继续这份阅读记录')!;await act(async()=>button.click());expect(l.resolveRecovery).toHaveBeenCalledWith('draft');
});
it('distinguishes save failure, stale choice errors and read-only retained records',async()=>{
 const l=fixture();l.error='已保存记录再次变化，请重新查看差异后选择。';
 await act(async()=>root.render(<ReadingLibraryStatus library={l}/>));expect(host.textContent).toContain('再次变化');
 l.recovery!.state='resolved';await act(async()=>root.render(<ReadingLibraryStatus library={l}/>));expect(host.textContent).toContain('只读');expect(host.textContent).not.toContain('继续这份阅读记录');
 l.recovery=null;l.recoveries=[];l.blocked=true;l.error='磁盘无法写入';await act(async()=>root.render(<ReadingLibraryStatus library={l}/>));
 expect(host.textContent).toContain('须先保存阅读记录才能离开');expect(host.textContent).toContain('重试保存');expect(host.textContent).not.toContain('两份阅读记录');
});
it('explains separate-original selection and unreadable disk without fabricating a second snapshot',async()=>{
 const l=fixture();l.recovery!.disk=null;l.recovery!.reason='unreadable';await act(async()=>root.render(<ReadingLibraryStatus library={l}/>));
 expect(host.textContent).toContain('另存为未关联原文件');expect(host.textContent).toContain('暂时无法读取');expect(host.textContent).not.toContain('继续已保存的记录');
});
