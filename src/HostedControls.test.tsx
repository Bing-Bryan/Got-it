import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {HostedSettings,HostedStorageControls,HostedSendDisclosure} from './HostedControls';
import {hostedCapabilities} from './lib/runtime-mode';
import {browserBackup,browserStorageStatus} from './lib/browser-library';
vi.mock('./lib/runtime-mode',async original=>({...await original<typeof import('./lib/runtime-mode')>(),hostedCapabilities:vi.fn()}));
vi.mock('./lib/browser-library',()=>({browserStorageStatus:vi.fn().mockResolvedValue({persistent:false,usage:1048576}),browserBackup:vi.fn(),sha256:vi.fn(),storeSampleImages:vi.fn()}));
it('keeps storage scope and backup failures discoverable without claiming a backup succeeded',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),save=vi.fn().mockRejectedValue(new Error('空间不足'));
 try{
  await act(async()=>root.render(<HostedStorageControls save={save} onRestore={vi.fn()}/>));
  const details=host.querySelector('details')!;
  expect(details.open).toBe(false);expect(details.querySelector('summary')?.textContent).toBe('保存与隐私');
  vi.mocked(browserStorageStatus).mockResolvedValue({persistent:true,usage:2097152});
  await act(async()=>{details.open=true;await new Promise(resolve=>setTimeout(resolve,0));});
  expect(browserStorageStatus).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('已获持久存储');expect(host.textContent).toContain('2.0 MB');
  expect(host.textContent).toContain('保存在当前浏览器');expect(host.querySelector<HTMLDetailsElement>('.hosted-storage-details')?.open).toBe(false);expect(host.textContent).toContain('清除网站数据可能丢失成果');expect(host.textContent).not.toContain('Safari');expect(host.querySelectorAll('.hosted-backup-actions .secondary-action')).toHaveLength(2);expect(host.textContent).toContain('不会跨设备或浏览器同步');
  await act(async()=>host.querySelector('button')!.click());
  expect(host.querySelector('[role=alert]')?.textContent).toBe('空间不足');expect(browserBackup).not.toHaveBeenCalled();
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(details.open).toBe(false);expect(document.activeElement).toBe(details.querySelector('summary'));
  await act(async()=>{details.open=true;document.body.dispatchEvent(new Event('pointerdown',{bubbles:true}));});expect(details.open).toBe(false);
 }finally{await act(async()=>root.unmount());host.remove();}
});
it('shows request and search destinations in the compact prompt before any action',async()=>{
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
 try{await act(async()=>root.render(<HostedSendDisclosure compact/>));expect(host.textContent).toContain('选区、有限上下文与追问');expect(host.textContent).toContain('托管及模型服务');expect(host.textContent).toContain('博查');expect(host.querySelector('details')).toBeNull();}finally{await act(async()=>root.unmount());host.remove();}
});

it('does not round small browser usage down to an apparent empty library',async()=>{
 vi.mocked(browserStorageStatus).mockResolvedValue({persistent:false,usage:100});
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),restore=vi.fn();
 try{await act(async()=>root.render(<HostedStorageControls save={vi.fn()} onRestore={restore}/>));expect(host.textContent).toContain('少于 0.1 MB');expect(host.textContent).not.toContain('0.0 MB');await act(async()=>host.querySelectorAll<HTMLButtonElement>('.hosted-backup-actions button')[1].click());expect(restore).toHaveBeenCalledOnce();}finally{await act(async()=>root.unmount());host.remove();}
});

it('does not turn an unreadable capability check into a definite search or quota claim',async()=>{
 vi.mocked(hostedCapabilities).mockRejectedValue(new TypeError('Failed to fetch'));
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
 try{await act(async()=>{root.render(<HostedSettings/>);await new Promise(resolve=>setTimeout(resolve,0));});expect(host.querySelector('[role=status]')?.textContent).toBe('额度暂时无法读取');expect(host.textContent).toContain('联网查找来源：暂时无法确认');expect(host.textContent).not.toContain('搜索服务尚未配置');expect(host.textContent).not.toContain('Failed to fetch');}finally{await act(async()=>root.unmount());host.remove();}
});

it('says search status is still loading, then reports the read capability',async()=>{
 let resolve!:(value:any)=>void;vi.mocked(hostedCapabilities).mockReturnValue(new Promise(r=>{resolve=r;}));
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
 try{await act(async()=>root.render(<HostedSettings/>));expect(host.textContent).toContain('联网查找来源：正在读取…');expect(host.textContent).not.toContain('搜索服务尚未配置');
  await act(async()=>{resolve({model:'deepseek-flash',searchAvailable:true,quota:{remaining:3,browserLimit:30,globalExhausted:false,resetAt:'2026-10-18T00:00:00Z'}});await new Promise(r=>setTimeout(r,0));});
  expect(host.textContent).toContain('联网查找来源：已配置博查搜索');expect(host.querySelector('[role=status]')?.textContent).toContain('今日剩余 3 / 30 次');}finally{await act(async()=>root.unmount());host.remove();}
});
