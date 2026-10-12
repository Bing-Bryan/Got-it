import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {ReadingLibraryNavigation,ReadingLibraryStatus} from './ReadingLibraryView';
import {webWorkspace} from './test-support/web';
import type {useReadingLibrary} from './useReadingLibrary';

it('keeps popup titles, original URLs and copying without extra source metadata on either reading side',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),workspace=webWorkspace();
  if(workspace.document.kind!=='web')throw Error();
  const web=workspace.document.web;
  web.retrieval={kind:'public-service',provider:'fxtwitter',url:'https://api.fxtwitter.com/2/status/123'};
  const sourceBefore=JSON.stringify(web),translate=vi.fn(),writeText=vi.fn().mockResolvedValue(undefined);
  const clipboardBefore=Object.getOwnPropertyDescriptor(navigator,'clipboard');
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  const library={entry:{id:'active',workspace,history:[]},recoveries:[],ready:true,status:'已保存',list:{nativePicker:false,warnings:[],entries:[{id:'active',filename:'当前网页',kind:'web',url:web.originalUrl},{id:'other',filename:'另一网页',kind:'web',url:'https://example.com/other'}]},translate} as unknown as ReturnType<typeof useReadingLibrary>;
  try{
    for(const side of ['original','translated']as const){
      workspace.readingSide=side;
      await act(async()=>root.render(<><ReadingLibraryNavigation library={library} importCopy={vi.fn()}/><ReadingLibraryStatus library={library} hideWebSource/></>));
      expect(host.querySelector('.web-source-state')).toBeNull();
      if(!host.querySelector('.library-popup'))await act(async()=>host.querySelector<HTMLButtonElement>('.library-current')!.click());
      const popup=host.querySelector('.library-popup')!;
      expect(popup.querySelector('.library-item.current .library-open')?.textContent).toBe('当前网页');
      const link=popup.querySelector<HTMLAnchorElement>('.library-item.current .library-source-url')!;
      expect(link.href).toBe(web.originalUrl);
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
      expect(popup.querySelectorAll('.library-source-url')).toHaveLength(2);
      expect(popup.textContent).not.toMatch(/导入于|FxTwitter|未独立核验|查看获取接口/);
      expect(popup.querySelector('.library-current-source-facts')).toBeNull();
      const copy=popup.querySelector<HTMLButtonElement>('.library-item.current .library-copy-url')!;
      expect(copy.getAttribute('aria-label')).toBe('复制来源：当前网页');
      copy.focus();expect(document.activeElement).toBe(copy);
      await act(async()=>copy.click());
      expect(writeText).toHaveBeenLastCalledWith(web.originalUrl);
      expect(popup.textContent).toContain('来源已复制');
    }
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(web)).toBe(sourceBefore);
    expect(translate).not.toHaveBeenCalled();
  }finally{
    await act(async()=>root.unmount());host.remove();
    if(clipboardBefore)Object.defineProperty(navigator,'clipboard',clipboardBefore);else Reflect.deleteProperty(navigator,'clipboard');
  }
});
