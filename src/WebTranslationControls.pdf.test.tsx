import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {pdfSourceFromPages} from './lib/pdf-translation';
import {TRANSLATION_CONTRACT_VERSION,translationModelConfig,type WebTranslationState} from './lib/web-translation';
import {createInitialWorkspace} from './sample';
import type {useReadingLibrary} from './useReadingLibrary';
// Synthetic two-page PDF source; the toolbar reads it locally, never through a model.
const hash='c'.repeat(64);
const source=pdfSourceFromPages([
 {page:1,scanned:false,paragraphs:[{id:'pdf-p1-b0',page:1,text:'First synthetic paragraph.',rects:[[40,200,300,212]]}]},
 {page:2,scanned:false,paragraphs:[{id:'pdf-p2-b0',page:2,text:'Second synthetic paragraph.',rects:[[40,200,300,212]]}]},
],hash);
vi.mock('./usePdfTranslationSource',async original=>({...await original<typeof import('./usePdfTranslationSource')>(),usePdfTranslationSource:(_entry:unknown,_resource:unknown,enabled:boolean)=>({source:enabled?source:null,error:false})}));
import {WebTranslationControls} from './WebTranslationControls';

async function setup(units:Record<string,string>|null,side:'original'|'translated'='original'){
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),workspace=createInitialWorkspace();
 workspace.document={id:'doc',filename:'safe.pdf',kind:'pdf',isDemo:false,contentHash:hash,importedAt:'2026',pdf:{resourceId:hash,pages:[{view:[0,0,400,300],rotation:0},{view:[0,0,400,300],rotation:0}]}} as typeof workspace.document;
 if(units)workspace.webTranslation={version:TRANSLATION_CONTRACT_VERSION,id:'t',target:'zh',documentId:'doc',sourceVersion:source.sourceVersion,status:'partial',modelConfig:translationModelConfig(),units,updatedAt:'2026'} as WebTranslationState;
 workspace.readingSide=side;
 const library={entry:{id:'entry'},status:'已保存到本机',ready:true,readOnly:false,autoTranslate:false,translationRunning:false,translationProgress:'',translationRepairCount:0,translate:vi.fn(),stopTranslation:vi.fn(),setAutoTranslation:vi.fn()} as unknown as ReturnType<typeof useReadingLibrary>;
 const onSide=vi.fn();
 await act(async()=>root.render(<WebTranslationControls workspace={workspace} library={library} onSide={onSide}/>));
 return {host,library,onSide,dispose:async()=>{await act(async()=>root.unmount());host.remove();}};
}

it('starts a PDF translation from the same icon after the short permission panel, without per-page hints',async()=>{
 const t=await setup(null);
 try{
  const icon=t.host.querySelector<HTMLButtonElement>('.translation-side-toggle')!;expect(icon.title).toBe('翻译为中文');
  await act(async()=>icon.click());
  expect(t.host.querySelector('.translation-permission')!.textContent).toContain('在原页对应位置显示中文');expect(t.host.textContent).not.toContain('以后自动翻译');
  expect(t.library.translate).not.toHaveBeenCalled();
  await act(async()=>[...t.host.querySelectorAll('button')].find(b=>b.textContent==='开始译中')!.click());
  expect(t.library.translate).toHaveBeenCalledOnce();
 }finally{await t.dispose();}
});

it('switches the whole PDF with one icon once a paragraph is translated and keeps resume truthful',async()=>{
 const t=await setup({'pdf-p1-b0--v2-part0':'第一段译文。'});
 try{
  const icon=t.host.querySelector<HTMLButtonElement>('.translation-side-toggle')!;
  expect(icon.title).toBe('切换到中文译文（部分）');expect(icon.getAttribute('aria-pressed')).toBe('false');
  expect(t.host.querySelector('.pdf-translation-pages')!.textContent).toBe('中文 1 / 2 页');expect(t.host.textContent).not.toContain('每页');
  expect([...t.host.querySelectorAll('button')].some(b=>b.textContent==='继续翻译')).toBe(true);
  await act(async()=>icon.click());
  expect(t.onSide).toHaveBeenCalledWith('translated');expect(t.library.translate).not.toHaveBeenCalled();
 }finally{await t.dispose();}
 const back=await setup({'pdf-p1-b0--v2-part0':'第一段译文。'},'translated');
 try{const icon=back.host.querySelector<HTMLButtonElement>('.translation-side-toggle')!;expect(icon.title).toBe('切换到原文（当前为部分中文译文）');await act(async()=>icon.click());expect(back.onSide).toHaveBeenCalledWith('original');}finally{await back.dispose();}
});

it('offers no switch to an empty Chinese side when no paragraph passed checks',async()=>{
 const t=await setup({});
 try{
  expect(t.host.querySelector('.translation-side-toggle')).toBeNull();
  expect([...t.host.querySelectorAll('button')].some(b=>b.textContent==='继续翻译')).toBe(true);
  expect(t.host.querySelector('.pdf-translation-pages')!.textContent).toBe('中文 0 / 2 页');
 }finally{await t.dispose();}
});
