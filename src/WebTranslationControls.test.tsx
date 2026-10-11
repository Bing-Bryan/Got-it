import {act} from 'react';import{createRoot}from'react-dom/client';import{expect,it,vi}from'vitest';
import{WebTranslationControls}from'./WebTranslationControls';import{webWorkspace}from'./test-support/web';import type{useReadingLibrary}from'./useReadingLibrary';

it('uses one accessible icon button to switch existing reading sides without requesting translation', async () => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const workspace = webWorkspace();
  workspace.webTranslation = {version:2,id:'toggle',target:'zh',documentId:workspace.document.id,sourceVersion:workspace.document.contentHash!,status:'complete',modelConfig:{model:'gpt-6.1-sol',reasoningEffort:'medium'},units:{'saved-unit':'已保存的译文'},updatedAt:new Date().toISOString()};
  const translate = vi.fn(), onSide = vi.fn();
  const library = {status:'已保存',ready:true,autoTranslate:false,translate} as unknown as ReturnType<typeof useReadingLibrary>;
  const render = () => root.render(<WebTranslationControls workspace={workspace} library={library} onSide={onSide}/>);
  try {
    workspace.readingSide = 'original';
    await act(async () => render());
    const button = host.querySelector<HTMLButtonElement>('.translation-side-toggle')!;
    expect(host.querySelectorAll('.translation-actions button')).toHaveLength(1);
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.tabIndex).toBe(0);
    expect(button.getAttribute('aria-label')).toBe('切换到中文译文');
    expect(button.title).toBe('切换到中文译文');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    expect(onSide).toHaveBeenLastCalledWith('translated');
    workspace.readingSide = 'translated';
    await act(async () => render());
    expect(button.getAttribute('aria-label')).toBe('切换到原文');
    expect(button.title).toBe('切换到原文');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await act(async () => button.click());
    expect(onSide).toHaveBeenLastCalledWith('original');
    expect(onSide).toHaveBeenCalledTimes(2);
    expect(translate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps partial translation explicit on both toggle directions and retains stop, progress and failure states', async () => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const workspace = webWorkspace();
  workspace.webTranslation = {version:2,id:'partial',target:'zh',documentId:workspace.document.id,sourceVersion:workspace.document.contentHash!,status:'partial',modelConfig:{model:'gpt-6.1-sol',reasoningEffort:'medium'},units:{'saved-unit':'已保存的译文'},updatedAt:new Date().toISOString()};
  const translate = vi.fn(), onSide = vi.fn(), stopTranslation = vi.fn();
  const library = {status:'保存失败',ready:true,autoTranslate:false,translationRunning:true,translationProgress:'翻译中',translate,stopTranslation} as unknown as ReturnType<typeof useReadingLibrary>;
  const render = () => root.render(<WebTranslationControls workspace={workspace} library={library} onSide={onSide}/>);
  try {
    for (const side of ['original','translated'] as const) {
      workspace.readingSide = side;
      await act(async () => render());
      const button = host.querySelector<HTMLButtonElement>('.translation-side-toggle')!;
      const label = side === 'original' ? '切换到中文译文（部分）' : '切换到原文（当前为部分中文译文）';
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.title).toBe(label);
      expect(host.textContent).toContain('停止翻译');
      expect(host.querySelector('.translation-progress')?.textContent).toBe('翻译中');
      expect(host.querySelector('.translation-status')?.textContent).toBe('保存失败');
      await act(async () => button.click());
      expect(onSide).toHaveBeenLastCalledWith(side === 'original' ? 'translated' : 'original');
    }
    expect(translate).not.toHaveBeenCalled();
    expect(stopTranslation).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('shows the explicit translation action without a reading-side toggle when no translation exists', async () => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const library = {status:'已保存',ready:true,autoTranslate:false,translate:vi.fn()} as unknown as ReturnType<typeof useReadingLibrary>;
  try {
    await act(async () => root.render(<WebTranslationControls workspace={webWorkspace()} library={library} onSide={vi.fn()}/>));
    expect(host.querySelector('.translation-side-toggle')).toBeNull();
    expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(['全文译中']);
    expect(library.translate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('does not offer an empty translated side after the first batch fails, and retains retry and the error', async () => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const workspace = webWorkspace();
  workspace.webTranslation = {version:2,id:'empty',target:'zh',documentId:workspace.document.id,sourceVersion:workspace.document.contentHash!,status:'failed',modelConfig:{model:'gpt-6.1-sol',reasoningEffort:'medium'},units:{},error:'首批翻译失败',updatedAt:new Date().toISOString()};
  const translate = vi.fn(), onSide = vi.fn();
  const library = {status:'已保存',ready:true,autoTranslate:false,translate} as unknown as ReturnType<typeof useReadingLibrary>;
  const render = () => root.render(<WebTranslationControls workspace={workspace} library={library} onSide={onSide}/>);
  try {
    for (const units of [{}, {'empty-unit':'  '}] as Record<string,string>[]) {
      workspace.webTranslation.units = units;
      await act(async () => render());
      expect(host.querySelector('.translation-side-toggle')).toBeNull();
      expect(host.querySelector('.translation-progress')?.textContent).toBe('首批翻译失败');
      expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(['继续译中']);
      expect(translate).not.toHaveBeenCalled();
      expect(onSide).not.toHaveBeenCalled();
    }
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(translate).toHaveBeenCalledOnce();
    expect(onSide).not.toHaveBeenCalled();
    workspace.webTranslation.units = {'saved-unit':'已保存译文'};
    await act(async () => render());
    expect(host.querySelector('.translation-side-toggle')?.getAttribute('aria-label')).toBe('切换到中文译文（部分）');
    expect(host.querySelector('.translation-progress')?.textContent).toBe('首批翻译失败');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it('authorization only commits auto preference on start; remount cancels old document permission',async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);const translate=vi.fn(),setAutoTranslation=vi.fn();const library={status:"已保存到本机",autoTranslate:false,ready:true,translate,setAutoTranslation}as unknown as ReturnType<typeof useReadingLibrary>;const w=webWorkspace();const render=(key:string)=>root.render(<WebTranslationControls key={key} workspace={w} library={library} onSide={vi.fn()}/>);await act(async()=>render('A'));const click=async(text:string)=>{await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!.click());};await click('全文译中');await act(async()=>host.querySelector<HTMLInputElement>('input')!.click());await click('取消');expect(setAutoTranslation).not.toHaveBeenCalled();await click('全文译中');await act(async()=>render('B'));expect(host.textContent).not.toContain('开始译中');expect(translate).not.toHaveBeenCalled();await click('全文译中');await act(async()=>host.querySelector<HTMLInputElement>('input')!.click());await click('开始译中');expect(setAutoTranslation).toHaveBeenCalledWith(true);expect(translate).toHaveBeenCalledOnce();await act(async()=>root.unmount());host.remove();});

it('shows one save status without translation success duplication and keeps failures visible', async () => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
  const w=webWorkspace();
  w.webTranslation={version:2,id:'translation',target:'zh',documentId:w.document.id,sourceVersion:'a'.repeat(64),status:'complete',modelConfig:{model:'gpt-6.1-sol',reasoningEffort:'medium'},units:{'saved-unit':'已保存的译文'},updatedAt:new Date().toISOString()};
  const library={status:'已保存到本机',ready:true,autoTranslate:false} as ReturnType<typeof useReadingLibrary>;
  const render=()=>root.render(<WebTranslationControls workspace={w} library={library} saveStatus={library.status} onSide={vi.fn()}/>);
  await act(async()=>render());
  expect(host.querySelector('.translation-status')?.textContent).toBe('已保存');
  expect(host.textContent).not.toContain('已保存到本机');
  expect(host.textContent).toContain('部分图片／图表未导入');
  library.translationProgress='全文译中已保存';
  library.status='保存中';await act(async()=>render());
  expect(host.querySelector('.translation-status')?.textContent).toBe('保存中');
  expect(host.textContent).not.toContain('全文译中已保存');
  expect(host.textContent).not.toContain('待保存');
  library.translationProgress='翻译成果待核对，尚未确认保存';
  await act(async()=>render());
  expect(host.querySelector('.translation-progress')?.textContent).toBe('翻译成果待核对，尚未确认保存');
  library.translationProgress='';
  library.status='保存失败';await act(async()=>render());
  expect(host.textContent).toContain('保存失败');
  w.webTranslation.status='failed';w.webTranslation.error='翻译中断';await act(async()=>render());
  expect(host.textContent).toContain('翻译中断');
  expect(host.querySelector('.translation-side-toggle')?.getAttribute('aria-label')).toBe('切换到中文译文（部分）');
  await act(async()=>root.unmount());host.remove();
});

it('keeps public excerpt warning and source link visible on both sides without implying whole-site translation',async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),w=webWorkspace();if(w.document.kind!=='web')throw Error();w.document.web.coverage='public-excerpt';w.document.web.coverageReason='paywall';const library={ready:true,autoTranslate:false,status:'已保存到本机'}as ReturnType<typeof useReadingLibrary>;for(const side of['original','translated']as const){w.readingSide=side;await act(async()=>root.render(<WebTranslationControls workspace={w} library={library} onSide={vi.fn()}/>));expect(host.textContent).toContain('仅保存公开部分，付费内容未导入');expect(host.textContent).toContain('已保存公开正文译中');expect(host.textContent).not.toContain('全文译中');expect(host.querySelector('a')?.href).toBe(w.document.web.originalUrl);}await act(async()=>root.unmount());host.remove();});

it('places exact scope copy beside the translation toggle inside the shared toolbar, retaining incomplete media warnings',async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),w=webWorkspace();if(w.document.kind!=='web')throw Error();w.document.web.coverage='public-excerpt';w.document.web.coverageReason='paywall';w.webTranslation={version:2,id:'scope',target:'zh',documentId:w.document.id,sourceVersion:w.document.contentHash!,status:'partial',modelConfig:{model:'gpt-6.1-sol',reasoningEffort:'medium'},units:{'saved-unit':'已保存的译文'},updatedAt:new Date().toISOString()};const library={ready:true,autoTranslate:false,status:'已保存到本机'}as ReturnType<typeof useReadingLibrary>;for(const status of['partial','complete']as const){w.webTranslation.status=status;await act(async()=>root.render(<WebTranslationControls workspace={w} library={library} onSide={vi.fn()}/>));const warning=host.querySelector('.translation-scope-warning')!;expect(warning.textContent).toBe('仅保存公开部分，付费内容未导入。');expect(warning.closest('.translation-toolbar')).not.toBeNull();expect(warning.previousElementSibling?.getAttribute('aria-label')).toBe(status==='partial'?'切换到中文译文（部分）':'切换到中文译文');expect(host.textContent).not.toContain('翻译和知识贴仅针对本机保存的公开正文。');expect(host.querySelector('.translation-media-warning')?.textContent).toBe('部分图片／图表未导入');}delete w.document.web.coverage;delete w.document.web.coverageReason;await act(async()=>root.render(<WebTranslationControls workspace={w} library={library} onSide={vi.fn()}/>));expect(host.querySelector('.translation-scope-warning')).toBeNull();await act(async()=>root.unmount());host.remove();});
