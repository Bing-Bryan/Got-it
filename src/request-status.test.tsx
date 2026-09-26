import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RequestStatus } from './App';
it('keeps request elapsed time across remount and only prompts after eight seconds without body',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-23T10:00:00Z'));(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');const root=createRoot(host);const startedAt=new Date().toISOString();
 try{
  await act(async()=>root.render(<RequestStatus startedAt={startedAt} hasText={false} progress="正在搜索资料"/>));
  await act(async()=>vi.advanceTimersByTime(7999));expect(host.querySelector('.waiting-toast')).toBeNull();
  await act(async()=>vi.advanceTimersByTime(251));expect(host.textContent).toContain('查找资料');
  await act(async()=>root.render(<RequestStatus key="remount" startedAt={startedAt} hasText={false}/>));expect(host.querySelector('time')?.textContent).toBe('8.3s');expect(host.textContent).toContain('整理答案');
  await act(async()=>root.render(<RequestStatus key="remount" startedAt={startedAt} hasText={true}/>));expect(host.querySelector('.waiting-toast')).toBeNull();expect(host.querySelector('time')?.textContent).toBe('8.3s');
 }finally{await act(async()=>root.unmount());vi.useRealTimers();}
});
