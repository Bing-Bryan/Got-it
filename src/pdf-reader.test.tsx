import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Inquiry,DocumentSnapshot,SelectionDraft} from './types';
const mocks=vi.hoisted(()=>({binary:vi.fn(),request:vi.fn(),worker:vi.fn()}));
vi.mock('./lib/library-client',()=>({libraryBinary:mocks.binary,libraryRequest:mocks.request}));
vi.mock('tesseract.js',()=>({createWorker:mocks.worker,PSM:{AUTO:'3'}}));
vi.mock('pdfjs-dist',()=>({GlobalWorkerOptions:{},getDocument:()=>({destroy:async()=>{},promise:Promise.resolve({getPage:async(pageNumber:number)=>({pageNumber,getViewport:({scale}:{scale:number})=>({width:400*scale,height:300*scale,convertToViewportPoint:(x:number,y:number)=>[x*scale,(300-y)*scale],convertToPdfPoint:(x:number,y:number)=>[x/scale,300-y/scale]}),render:()=>({promise:Promise.resolve(),cancel:()=>{}}),getTextContent:async()=>({items:[]})})})}),TextLayer:class {async render(){} cancel(){}}}));
import PdfReader from './PdfReader';
let root:Root,host:HTMLDivElement;
const hash='a'.repeat(64),ocrId='b'.repeat(64);
const pdf:DocumentSnapshot={id:'doc',filename:'safe.pdf',kind:'pdf',isDemo:false,contentHash:hash,importedAt:'2026',pdf:{resourceId:hash,pages:[{view:[0,0,400,300],rotation:0},{view:[0,0,400,300],rotation:0}]}};
const inquiry:Inquiry={id:'i',intent:'explain',question:'q',status:'ready',createdAt:'2026',updatedAt:'2026',understanding:'',messages:[],anchor:{documentId:'doc',blockId:'pdf',headingPath:[],quote:'20%',prefix:'',suffix:'',start:0,end:3,matchStatus:'matched',pdf:{kind:'text',source:'ocr',fileHash:hash,page:1,rects:[[20,200,80,220]],ocrId,originalText:'2096'}}};
const click=async(selector:string)=>act(async()=>{(host.querySelector(selector)as HTMLElement).click();});
beforeEach(()=>{
 (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 vi.stubGlobal('IntersectionObserver',class{constructor(private cb:(entries:{isIntersecting:boolean}[])=>void){}observe(){this.cb([{isIntersecting:true}]);}disconnect(){}});
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('requestAnimationFrame',(cb:()=>void)=>{cb();return 1;});vi.stubGlobal('CSS',{escape:(s:string)=>s});
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(280);
 HTMLElement.prototype.scrollIntoView=vi.fn();HTMLCanvasElement.prototype.getContext=vi.fn(()=>({drawImage:()=>{}})) as never;HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,AA==';
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({x:0,y:0,left:0,top:0,right:240,bottom:180,width:240,height:180,toJSON:()=>{}}));
 mocks.request.mockReset();mocks.worker.mockReset();
 mocks.binary.mockReset().mockImplementation(async(path:string)=>({arrayBuffer:async()=>new ArrayBuffer(1),blob:async()=>new Blob(['png']),json:async()=>path.includes('/crops?')?{id:'c'.repeat(64)}:({version:1,fileHash:hash,page:1,lines:[{text:'2096',rect:[20,200,80,220],block:'region'}]})}));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('renders ordered continuous pages without navigation or zoom and consumes each jump once',async()=>{
 const onLocated=vi.fn();const props={onLocated,document:pdf as Extract<DocumentSnapshot,{kind:'pdf'}>,entryId:'entry',inquiries:[inquiry]};
 await act(async()=>root.render(<PdfReader {...props} target={{id:'i',nonce:1}}/>));
 expect([...host.querySelectorAll('[data-pdf-page]')].map(n=>n.getAttribute('data-pdf-page'))).toEqual(['1','2']);
 expect(host.querySelector('select')).toBeNull();expect(host.textContent).not.toContain('下一页');
 const calls=onLocated.mock.calls.length;
 await act(async()=>root.render(<PdfReader {...props} target={{id:'i',nonce:1}}/>));
 expect(onLocated).toHaveBeenCalledTimes(calls);
 await act(async()=>root.render(<PdfReader {...props} target={{id:'i',nonce:2}}/>));
 expect(onLocated).toHaveBeenCalledTimes(calls+1);
});
it.each(['explain','verify','ask'] as const)('uses the selected OCR quote for %s while preserving original geometry and recognition',async intent=>{
 const create=vi.fn();await act(async()=>root.render(<PdfReader document={pdf as Extract<DocumentSnapshot,{kind:'pdf'}>} entryId="entry" inquiries={[inquiry]} onCreate={create}/>));
 const text=host.querySelector('[data-line]')!.firstChild!;
 const range={commonAncestorContainer:text,startContainer:text,endContainer:text,getClientRects:()=>[{left:12,top:48,right:48,bottom:60,width:36,height:12}]} as unknown as Range;
 vi.spyOn(window,'getSelection').mockReturnValue({isCollapsed:false,rangeCount:1,getRangeAt:()=>range,toString:()=> '2096',removeAllRanges:()=>{}} as unknown as Selection);
 await act(async()=>host.querySelector('.pdf-page')!.dispatchEvent(new Event('pointerup',{bubbles:true})));
 expect(host.querySelector('textarea')).toBeNull();expect(host.querySelector('.pdf-selected-quote')?.textContent).toBe('2096');
 await click(`.pdf-card-actions button:nth-child(${['explain','verify','ask'].indexOf(intent)+1})`);
 if(intent==='ask') await act(async()=>{const input=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'这个图里的20%表示什么？');input.dispatchEvent(new Event('input',{bubbles:true}));});
 if(intent==='ask') await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 const draft=create.mock.calls[0][1] as SelectionDraft;expect(create.mock.calls[0][0]).toBe(intent);expect(draft.anchor.quote).toBe('2096');expect(draft.context).toBe('2096');expect(draft.anchor.pdf!.originalText).toBe('2096');expect(draft.anchor.pdf!.rects).toEqual([[20,200,80,220]]);
});
it('cancels a pointer draft with Escape even when keyboard focus is on the document body',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf as Extract<DocumentSnapshot,{kind:'pdf'}>} entryId="entry" inquiries={[]}/>));await click('.pdf-select-mode');expect(host.querySelector('.pdf-page')?.classList.contains('drawing')).toBe(true);
 await act(async()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(host.querySelector('.pdf-page')?.classList.contains('drawing')).toBe(false);expect(mocks.request).not.toHaveBeenCalled();
});
it('restores horizontal and vertical reading position together without competing smooth scrolls',async()=>{
 const {restorePosition}=await import('./useReadingLibrary');const scroll=document.createElement('div');scroll.className='reader-scroll';host.append(scroll);Object.defineProperties(scroll,{scrollHeight:{value:1000},clientHeight:{value:400}});scroll.scrollTo=vi.fn();restorePosition({ratio:.5,pdfPage:1,pdfZoom:2,pdfLeft:80});expect(scroll.scrollTo).toHaveBeenCalledWith({left:80,top:300,behavior:'instant'});
});

it.each(['explain','verify','ask'] as const)('shows all actions before OCR and starts OCR plus a crop only after choosing %s',async intent=>{
 const create=vi.fn();
 mocks.worker.mockResolvedValue({setParameters:async()=>{},terminate:async()=>{},recognize:async()=>({data:{blocks:[{paragraphs:[{lines:[{text:'Alpha 20%',bbox:{x0:20,y0:20,x1:200,y1:60}}]}]}]}})});
 mocks.request.mockImplementation(async(_path,data)=>({id:ocrId,data}));
 await act(async()=>root.render(<PdfReader document={pdf as Extract<DocumentSnapshot,{kind:'pdf'}>} entryId="entry" inquiries={[]} onCreate={create}/>));
 await click('.pdf-toolbar button:first-of-type');
 const surface=host.querySelector('.pdf-page')as HTMLElement;
 surface.setPointerCapture=vi.fn();surface.releasePointerCapture=vi.fn();
 for(const [type,x,y] of [['pointerdown',10,10],['pointerup',150,70]]as const){await act(async()=>surface.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:x,clientY:y})));}
 expect([...host.querySelectorAll('.pdf-card-actions button')].map(n=>n.textContent)).toEqual(['解释一下','查找来源','问一问']);
 expect(mocks.worker).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
 await click(`.pdf-card-actions button:nth-child(${['explain','verify','ask'].indexOf(intent)+1})`);
 if(intent==='ask') await act(async()=>{const input=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'这个图里的20%表示什么？');input.dispatchEvent(new Event('input',{bubbles:true}));});
 if(intent==='ask') await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 const draft=create.mock.calls[0][1]as SelectionDraft;
 expect(create.mock.calls[0][0]).toBe(intent);
 expect(draft.anchor.pdf).toMatchObject({page:1,source:'image',ocrId,cropId:'c'.repeat(64),originalText:'Alpha 20%'});

});
it.each([0,80])('uses one toolbar and targets the most visible page when the previous page ends at %s',async previousBottom=>{
 host.className='reader-scroll';
 await act(async()=>root.render(<PdfReader document={pdf as Extract<DocumentSnapshot,{kind:'pdf'}>} entryId="entry" inquiries={[]}/>));
 expect(host.querySelectorAll('.pdf-toolbar')).toHaveLength(1);
 await click('.pdf-select-mode');
 const first=host.querySelector('[data-pdf-page="1"]')!;const bounds=first.getBoundingClientRect();
 Object.defineProperty(first,'getBoundingClientRect',{value:()=>({...bounds,top:-200,bottom:previousBottom})});
 await act(async()=>host.dispatchEvent(new Event('scroll')));
 expect(host.querySelector('.pdf-page-number')?.textContent).toContain('2 / 2');
 await click('.pdf-select-mode');
 expect(host.querySelector('[data-pdf-page="1"] .drawing')).toBeNull();
 expect(host.querySelector('[data-pdf-page="2"] .drawing')).not.toBeNull();
});
it('restores legacy PDF positions to their own page and ignores old horizontal zoom offsets',async()=>{
 const {restorePosition}=await import('./useReadingLibrary');
 host.innerHTML='<div class="reader-scroll"><div class="pdf-reader"><section data-pdf-page="3"></section></div></div>';
 const scroll=host.querySelector('.reader-scroll')as HTMLElement;scroll.scrollTo=vi.fn();
 const sheet=host.querySelector('section')!;
 const bounds=sheet.getBoundingClientRect();Object.defineProperty(sheet,'getBoundingClientRect',{value:()=>({...bounds,top:900})});
 restorePosition({ratio:0,pdfPage:3,pdfZoom:2,pdfLeft:80});
 expect(scroll.scrollTo).toHaveBeenCalledWith({left:0,top:900,behavior:'instant'});
});

async function drawRegion(create=vi.fn()) {
 await act(async()=>root.render(<PdfReader document={pdf as Extract<DocumentSnapshot,{kind:'pdf'}>} entryId="entry" inquiries={[]} onCreate={create}/>));
 await click('.pdf-toolbar button');const surface=host.querySelector('.pdf-page')as HTMLElement;surface.setPointerCapture=vi.fn();surface.releasePointerCapture=vi.fn();
 for(const [type,x,y] of [['pointerdown',10,10],['pointerup',150,70]]as const)await act(async()=>surface.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:x,clientY:y})));
 return create;
}
it('keeps a card click, cancels outside it without OCR or AI, and supports a fresh selection',async()=>{
 const create=await drawRegion();
 await act(async()=>host.querySelector('.pdf-selection-card')!.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:300,clientY:250})));
 expect(host.querySelector('.pdf-selection-card')).not.toBeNull();
 await act(async()=>document.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:300,clientY:250})));
 expect(host.querySelector('.pdf-selection-card')).toBeNull();expect(mocks.worker).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
});
it.each(['empty','failure'])('continues with the image when OCR is %s without inventing recognized text',async kind=>{
 if(kind==='failure')mocks.worker.mockRejectedValue(new Error('worker unavailable'));else mocks.worker.mockResolvedValue({setParameters:async()=>{},terminate:async()=>{},recognize:async()=>({data:{blocks:[]}})});
 const create=await drawRegion();await click('.pdf-card-actions button:first-child');
 const a=create.mock.calls[0][1].anchor.pdf;expect(a.cropId).toBe('c'.repeat(64));expect(a.ocrId).toBeUndefined();expect(a.originalText).toBeUndefined();expect(a.context).toContain('未提取到辅助文字');
});
it.each(['.pdf-selection-card>button','.pdf-select-mode'])('does not create a note from late OCR after cancellation through %s',async selector=>{
 let release!:(v:unknown)=>void;const terminate=vi.fn(async()=>{});
 mocks.worker.mockResolvedValue({setParameters:async()=>{},terminate,recognize:()=>new Promise(r=>release=r)});
 const create=await drawRegion();await click('.pdf-card-actions button:first-child');
 await act(async()=>host.querySelector(selector)!.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:300,clientY:250})));
 await click(selector);
 await act(async()=>release({data:{blocks:[]}}));
 expect(create).not.toHaveBeenCalled();expect(terminate).toHaveBeenCalled();expect(host.querySelector('.pdf-selection-card')).toBeNull();expect(mocks.binary.mock.calls.some(([p])=>p.includes('/crops?'))).toBe(false);
});

it('keeps native text and region actions usable when a saved OCR resource is unavailable',async()=>{
 mocks.binary.mockImplementation(async(path:string)=>{if(path.endsWith(ocrId))throw new Error('OCR unavailable');return {arrayBuffer:async()=>new ArrayBuffer(1)};});
 await act(async()=>root.render(<PdfReader document={pdf as Extract<DocumentSnapshot,{kind:'pdf'}>} entryId="entry" inquiries={[inquiry]}/>));
 expect((host.querySelector('.pdf-toolbar button')as HTMLButtonElement).disabled).toBe(false);
 expect(host.textContent).toContain('OCR unavailable');
});

it('replaces a region draft when text inside that region is selected',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf as Extract<DocumentSnapshot,{kind:'pdf'}>} entryId="entry" inquiries={[inquiry]}/>));
 await click('.pdf-toolbar button:first-of-type');const surface=host.querySelector('.pdf-page')as HTMLElement;
 surface.setPointerCapture=vi.fn();surface.releasePointerCapture=vi.fn();
 for(const [type,x,y]of [['pointerdown',10,10],['pointerup',150,100]]as const)await act(async()=>surface.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:x,clientY:y})));
 const text=host.querySelector('[data-line]')!.firstChild!;
 const range={commonAncestorContainer:text,startContainer:text,endContainer:text,getClientRects:()=>[{left:12,top:48,right:48,bottom:60,width:36,height:12}]}as unknown as Range;
 vi.spyOn(window,'getSelection').mockReturnValue({isCollapsed:false,rangeCount:1,getRangeAt:()=>range,toString:()=> '2096',removeAllRanges:()=>{}}as unknown as Selection);
 await act(async()=>surface.dispatchEvent(new Event('pointerup',{bubbles:true})));
 expect(host.querySelector('.pdf-selected-quote')?.textContent).toBe('2096');
 expect(host.querySelector('.pdf-draft-box')).toBeNull();
});

it('keeps truthful save states and shows instructions inline without a help popup',async()=>{
 const props={document:pdf as Extract<DocumentSnapshot,{kind:'pdf'}>,entryId:'entry',inquiries:[]};
 await act(async()=>root.render(<PdfReader {...props} saveStatus="已保存到本机"/>));
 expect(host.querySelector('.pdf-save-state')?.textContent).toBe('✓ 已保存');
 expect(host.querySelector('.pdf-help')).toBeNull();expect(host.querySelectorAll('.pdf-sheet .pdf-status')).toHaveLength(0);
 expect(host.querySelector('.pdf-help-button')).toBeNull();expect(host.querySelector('.pdf-inline-help')?.textContent).toContain('文字可直接拖选');
 expect(mocks.worker).not.toHaveBeenCalled();expect(mocks.request).not.toHaveBeenCalled();
 await act(async()=>root.render(<PdfReader {...props} saveStatus="保存失败" saveError/>));
 expect(host.querySelector('.pdf-save-state')?.textContent).toBe('未保存');
});

it('ignores queued scroll observations after the PDF reader unmounts',async()=>{
 host.className='reader-scroll';const listen=vi.spyOn(host,'addEventListener');
 await act(async()=>root.render(<PdfReader document={pdf as Extract<DocumentSnapshot,{kind:'pdf'}>} entryId="entry" inquiries={[inquiry]}/>));
 const callback=listen.mock.calls.find(([name])=>name==='scroll')?.[1] as EventListener;
 expect(callback).toBeTypeOf('function');
 await act(async()=>root.unmount());root=createRoot(host);
 expect(()=>callback(new Event('scroll'))).not.toThrow();
});
