import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SourceCard } from './SourceCard';
import type { Source } from './types';

const source: Source = { id:'s',title:'公开报告',url:'https://example.org/report#section',domain:'example.org',excerpt:'Growth was 20%.',excerptKind:'quote',retrievalStatus:'matched',locatable:true };
function render(item: Source) { const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(<SourceCard source={item}/>);return host; }
it('shows the full checked quote immediately with one safe source link that prefers text location',()=>{
 const before=structuredClone(source);const host=render(source);
 expect(host.querySelector('details,summary')).toBeNull();expect(host.querySelector('blockquote')?.textContent).toBe(source.excerpt);
 expect(host.querySelector('.excerpt-label')?.textContent).toBe('片段已核对');
 expect(host.querySelectorAll('a')).toHaveLength(1);expect(host.querySelector('a')?.textContent).toBe('打开来源 ');
 expect(host.querySelector('a')?.href).toContain('#section:~:text=');expect(host.querySelector('.source-reading-boundary')).toBeNull();expect(source).toEqual(before);
});
it.each([
 {url:'https://example.org/report.pdf'}, {locatable:false}, {retrievalStatus:'unavailable' as const}, {excerptKind:'summary' as const},
])('falls back to a plain source URL when location is unavailable: %j',patch=>{
 const item={...source,...patch};const host=render(item);expect(host.querySelectorAll('a')).toHaveLength(1);expect(host.querySelector('a')?.href).toBe(item.url);
});
it('keeps unverified and summary text visible without offering verified-copy controls',()=>{
 for(const kind of ['unverified','summary'] as const){const host=render({...source,excerptKind:kind});expect(host.querySelector('.excerpt-label')?.textContent).toBe(kind==='summary'?'搜索摘要，未核对正文':'片段未核对');expect(host.querySelector('blockquote')?.textContent).toBe(source.excerpt);expect(host.querySelector('button')).toBeNull();expect(host.querySelector('.source-reading-boundary')?.textContent).toBe(kind==='summary'?undefined:'AI 提供的引用线索');}
});
it('does not advertise checked quotes or active URLs for invalid links or absent quote text',()=>{
 const unsafe=render({...source,url:'javascript:alert(1)'});expect(unsafe.querySelector('a,button')).toBeNull();expect(unsafe.textContent).toContain('来源链接不可用');expect(unsafe.textContent).not.toContain('片段已核对');
 const missing=render({...source,excerpt:' '});expect(missing.querySelector('blockquote,button')).toBeNull();expect(missing.textContent).toContain('未取得片段');
 const legacy=render({...source,excerpt:undefined,snippet:'旧摘要'});expect(legacy.querySelector('.excerpt-label')?.textContent).toBe('片段未核对');expect(legacy.querySelector('a')?.href).toBe(source.url);expect(legacy.querySelector('button')).toBeNull();
});
it('keeps the excerpt visible after clipboard failure and permits a successful retry',async()=>{
 const writeText=vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);vi.stubGlobal('navigator',{clipboard:{writeText}});
 const host=document.createElement('div');const root=createRoot(host);
 try {await act(async()=>root.render(<SourceCard source={source}/>));await act(async()=>host.querySelector('button')!.click());expect(host.textContent).toContain('复制未成功');expect(host.querySelector('blockquote')?.textContent).toBe(source.excerpt);await act(async()=>host.querySelector('button')!.click());expect(host.textContent).toContain('引用已复制');expect(writeText).toHaveBeenLastCalledWith(source.excerpt);}
 finally {await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
