import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {DocumentSnapshot} from './types';
import {pdfSourceFromPages} from './lib/pdf-translation';
import {TRANSLATION_CONTRACT_VERSION,translationModelConfig,type WebTranslationState} from './lib/web-translation';
const mocks=vi.hoisted(()=>({binary:vi.fn(),loads:0,override:null as unknown}));
vi.mock('./lib/runtime-mode',()=>({HOSTED:false,hostedCapabilities:async()=>({supportsImages:false})}));
vi.mock('./lib/library-client',()=>({libraryBinary:mocks.binary,libraryRequest:vi.fn()}));
vi.mock('tesseract.js',()=>({createWorker:vi.fn(),PSM:{AUTO:'3'}}));
function mockViewport(scale:number):any { return {scale,width:400*scale,height:300*scale,clone:({scale:next}:{scale:number})=>mockViewport(next),convertToViewportPoint:(x:number,y:number)=>[x*scale,(300-y)*scale],convertToPdfPoint:(x:number,y:number)=>[x/scale,300-y/scale]}; }
vi.mock('pdfjs-dist',()=>({GlobalWorkerOptions:{},getDocument:()=>({destroy:async()=>{},promise:Promise.resolve({getPage:async(pageNumber:number)=>({pageNumber,getViewport:({scale}:{scale:number})=>mockViewport(scale),render:()=>({promise:Promise.resolve(),cancel:()=>{}}),getTextContent:async()=>({items:[]})})})}),TextLayer:class {async render(){} cancel(){}}}));
// Synthetic three-page source: two text pages and one image-only page; no real document text.
const hash='a'.repeat(64);
const source=pdfSourceFromPages([
 {page:1,scanned:false,paragraphs:[{id:'pdf-p1-b0',page:1,text:'First synthetic paragraph on page one.',rects:[[40,200,300,212]]},{id:'pdf-p1-b1',page:1,text:'Second synthetic paragraph on page one.',rects:[[40,200,300,212]]}]},
 {page:2,scanned:false,paragraphs:[{id:'pdf-p2-b0',page:2,text:'Only paragraph on page two.',rects:[[40,200,300,212]]}]},
 {page:3,scanned:true,paragraphs:[]},
],hash);
vi.mock('./lib/pdf-translation-loader',()=>({loadPdfTranslationSource:async()=>{mocks.loads++;return mocks.override??source;}}));
import PdfReader from './PdfReader';
const page={view:[0,0,400,300] as [number,number,number,number],rotation:0};
const pdf={id:'doc',filename:'safe.pdf',kind:'pdf',isDemo:false,contentHash:hash,importedAt:'2026',pdf:{resourceId:hash,pages:[page,page,page]}} as Extract<DocumentSnapshot,{kind:'pdf'}>;
const translation:WebTranslationState={version:TRANSLATION_CONTRACT_VERSION,id:'t',target:'zh',documentId:'doc',sourceVersion:source.sourceVersion,status:'partial',modelConfig:translationModelConfig(),units:{'pdf-p1-b0--v2-part0':'第一页第一段译文。'},updatedAt:'2026'};
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
 (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;mocks.loads=0;
 vi.stubGlobal('IntersectionObserver',class{constructor(private cb:(entries:{isIntersecting:boolean}[])=>void){}observe(){this.cb([{isIntersecting:true}]);}disconnect(){}});
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('requestAnimationFrame',(cb:()=>void)=>{cb();return 1;});
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(280);HTMLCanvasElement.prototype.getContext=vi.fn(()=>({drawImage:()=>{}})) as never;
 mocks.binary.mockReset().mockResolvedValue({arrayBuffer:async()=>new ArrayBuffer(1)});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const sheet=(n:number)=>host.querySelector<HTMLElement>(`[data-pdf-page="${n}"]`)!;
const layer=(n:number)=>sheet(n).querySelector<HTMLElement>('.pdf-translation-layer');
const select=(node:Node,start:number,end:number,endNode=node)=>{const range=document.createRange();range.setStart(node,start);range.setEnd(endNode,end);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);};
const release=async(n:number)=>{await act(async()=>{sheet(n).querySelector('.pdf-page')!.dispatchEvent(new Event('pointerup',{bubbles:true}));});};
const both:WebTranslationState={...translation,units:{...translation.units,'pdf-p1-b1--v2-part0':'第一页第二段译文。'}};

it('reads no text layer and draws nothing extra without a saved translation',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} showTranslation/>));
 expect(host.querySelector('.pdf-translation-layer')).toBeNull();expect(host.querySelector('.pdf-draft-switch')).toBeNull();expect(mocks.loads).toBe(0);
});

it('keeps the original page on the original side and offers no per-page switch',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation}/>));
 expect(host.querySelector('.pdf-translation-layer')).toBeNull();expect(host.querySelector('.pdf-draft-switch')).toBeNull();
 expect(sheet(1).querySelector('canvas')).not.toBeNull();expect(host.querySelector('.pdf-translation-note')).toBeNull();
});

it('draws checked Chinese over its own paragraph box and leaves untranslated paragraphs and pages as the original',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} showTranslation/>));
 const paragraphs=[...layer(1)!.querySelectorAll<HTMLElement>('.pdf-translation-paragraph')];
 expect(paragraphs.map(p=>[p.dataset.pdfParagraph,p.textContent])).toEqual([['pdf-p1-b0','第一页第一段译文。']]);
 // Same page geometry as the original line box (PDF y=200..212 on a 300-high page), not a reflowed column.
 const scale=(parseFloat(paragraphs[0].style.left)+1)/40,top=parseFloat(paragraphs[0].style.top),width=parseFloat(paragraphs[0].style.width);
 expect(scale).toBeGreaterThan(0);expect(top/scale).toBeCloseTo(88-1.8,1);expect((width-2)/scale).toBeCloseTo(260,1);
 expect(sheet(1).querySelector('canvas')).not.toBeNull();expect(sheet(1).querySelector<HTMLElement>('.pdf-page-wrap')!.hidden).toBe(false);
 expect(layer(2)).toBeNull();expect(host.querySelector('.pdf-draft-switch')).toBeNull();
});

it('says an image-only page cannot be translated instead of showing it as done or failed',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} showTranslation/>));
 expect(sheet(3).querySelector('.pdf-translation-note')!.textContent).toBe('此页为图片，暂不能全文翻译，可框选后提问');
 expect(sheet(1).querySelector('.pdf-translation-note')).toBeNull();
});

it('offers the full Chinese on click when a paragraph cannot fit its original box',async()=>{
 vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockReturnValue(200);vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(10);
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} showTranslation/>));
 const paragraph=layer(1)!.querySelector<HTMLElement>('.pdf-translation-paragraph')!,more=paragraph.querySelector<HTMLButtonElement>('.pdf-translation-more')!;
 expect(paragraph.classList.contains('pdf-translation-paragraph--cut')).toBe(true);expect(more.getAttribute('aria-expanded')).toBe('false');
 // Shrunk to the readable floor (60% of the line height or 9 screen px), never to nothing.
 expect(parseFloat(paragraph.style.fontSize)).toBeGreaterThan(0);
 await act(async()=>more.click());
 expect(layer(1)!.querySelector('.pdf-translation-full')!.textContent).toContain('第一页第一段译文。');expect(more.getAttribute('aria-expanded')).toBe('true');
 await act(async()=>layer(1)!.querySelector<HTMLButtonElement>('.pdf-translation-close')!.click());
 expect(layer(1)!.querySelector('.pdf-translation-full')).toBeNull();
});

it('turns a selection in the in-place Chinese into a sticky anchored to the original paragraph without sending anything on its own',async()=>{
 Range.prototype.getClientRects=function(){return [{left:10,top:10,right:60,bottom:24,width:50,height:14}] as unknown as DOMRectList;};
 Range.prototype.getBoundingClientRect=function(){return {left:10,top:10,right:60,bottom:24,width:50,height:14} as DOMRect;};
 const onCreate=vi.fn();
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} onCreate={onCreate} revisionId="r" onBookmarkSaved={vi.fn()}/>));
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} onCreate={onCreate} revisionId="r" onBookmarkSaved={vi.fn()} showTranslation/>));
 select(layer(1)!.querySelector('[data-pdf-paragraph="pdf-p1-b0"] .pdf-translation-text')!.firstChild!,3,6);
 await release(1);
 expect(onCreate).not.toHaveBeenCalled();
 const card=sheet(1).querySelector('.pdf-selection-card')!;expect(card.textContent).toContain('第一段');
 // Bookmarks stay unavailable for translated text, as before.
 expect(card.querySelector('.selection-bookmark-container')).toBeNull();
 await act(async()=>(card.querySelector('[data-intent="explain"]') as HTMLButtonElement).click());
 const [intent,draft]=onCreate.mock.calls[0];
 expect(intent).toBe('explain');
 expect(draft.anchor).toMatchObject({blockId:'pdf-p1-b0',quote:'First synthetic paragraph on page one.',pdf:{kind:'text',source:'native',fileHash:hash,page:1,rects:[[40,200,300,212]]},translation:{translationId:'t',sourceVersion:source.sourceVersion,blockId:'pdf-p1-b0',quote:'第一段',start:3,end:6}});
 expect(draft.context).toContain('译文选区：第一段');expect(draft.context).toContain('对应原文段落（非逐词对齐）：First synthetic paragraph on page one.');
 expect(draft.context).not.toContain('page two');
});

it('asks for a smaller selection when it spans two Chinese paragraphs',async()=>{
 const onCreate=vi.fn();
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={both} onCreate={onCreate} showTranslation/>));
 const a=layer(1)!.querySelector('[data-pdf-paragraph="pdf-p1-b0"] .pdf-translation-text')!.firstChild!,b=layer(1)!.querySelector('[data-pdf-paragraph="pdf-p1-b1"] .pdf-translation-text')!.firstChild!;
 select(a,1,3,b);await release(1);
 expect(sheet(1).querySelector('.pdf-selection-card')).toBeNull();expect(sheet(1).textContent).toContain('请在同一段中文内选择文字。');
});

it('locates a translated sticky on the same page box whichever side is shown',async()=>{
 vi.stubGlobal('CSS',{escape:(s:string)=>s});
 const sticky={id:'d',intent:'explain',question:'q',status:'ready',createdAt:'2026',updatedAt:'2026',understanding:'',messages:[],anchor:{documentId:'doc',blockId:'pdf-p1-b0',headingPath:['第 1 页'],quote:'First synthetic paragraph on page one.',prefix:'',suffix:'',start:0,end:38,matchStatus:'matched',translation:{version:2,translationId:'t',sourceVersion:source.sourceVersion,blockId:'pdf-p1-b0',quote:'第一段',prefix:'',suffix:'',start:3,end:6},pdf:{kind:'text',source:'native',fileHash:hash,page:1,rects:[[40,200,300,212]]}}} as import('./types').Inquiry;
 for(const [showTranslation,nonce] of [[true,1],[false,2]] as const){
  const onLocated=vi.fn();
  await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[sticky]} translation={translation} showTranslation={showTranslation} onLocated={onLocated} target={{id:'d',nonce}}/>));
  expect(onLocated).toHaveBeenCalledWith('d',expect.any(Boolean),undefined,sheet(1).querySelector('[data-pdf-inquiry="d"]'));
  expect(!!layer(1)).toBe(showTranslation);
 }
});

it('refuses a Chinese selection whose paragraph has no valid position on the original page',async()=>{
 const broken=pdfSourceFromPages([{page:1,scanned:false,paragraphs:[{id:'pdf-p1-b0',page:1,text:'First synthetic paragraph on page one.',rects:[[40,200,900,212]]}]}],hash);
 mocks.override=broken;
 const onCreate=vi.fn();
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={{...translation,sourceVersion:broken.sourceVersion}} onCreate={onCreate} showTranslation/>));
 select(layer(1)!.querySelector('[data-pdf-paragraph="pdf-p1-b0"] .pdf-translation-text')!.firstChild!,0,3);await release(1);
 expect(sheet(1).querySelector('.pdf-selection-card')).toBeNull();expect(sheet(1).textContent).toContain('此段无法对应到原页位置');
 mocks.override=null;
});

it('stays on the original page when the Chinese side has no shown paragraph yet',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={{...translation,units:{}}} showTranslation/>));
 expect(host.querySelector('.pdf-translation-layer')).toBeNull();expect(host.querySelector('.pdf-translation-note')).toBeNull();
});

it('covers words with the sampled page colour and falls back to white on a blank canvas, never black',async()=>{
 const pixels=(rgba:number[])=>({drawImage:()=>{},getImageData:(_x:number,_y:number,w:number,h:number)=>({data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>rgba[i%4])})});
 HTMLCanvasElement.prototype.getContext=vi.fn(()=>pixels([0,0,0,0])) as never;
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} showTranslation/>));
 const paragraph=()=>layer(1)!.querySelector<HTMLElement>('.pdf-translation-paragraph')!;
 expect(paragraph().style.backgroundColor).toBe('rgb(255, 255, 255)');expect(paragraph().style.color).toBe('rgb(27, 27, 31)');
 await act(async()=>root.unmount());root=createRoot(host);
 HTMLCanvasElement.prototype.getContext=vi.fn(()=>pixels([20,30,40,255])) as never;
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} showTranslation/>));
 expect(paragraph().style.backgroundColor).toBe('rgb(20, 30, 40)');expect(paragraph().style.color).toBe('rgb(255, 255, 255)');
});

it('keeps a one-line label on one line by narrowing it slightly instead of cutting it',async()=>{
 vi.spyOn(HTMLElement.prototype,'scrollWidth','get').mockReturnValue(320);vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(280);
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} showTranslation/>));
 const paragraph=layer(1)!.querySelector<HTMLElement>('.pdf-translation-paragraph')!;
 expect(paragraph.style.whiteSpace).toBe('nowrap');expect(paragraph.querySelector<HTMLElement>('.pdf-translation-text')!.style.transform).toBe('scaleX(0.875)');
 expect(paragraph.classList.contains('pdf-translation-paragraph--cut')).toBe(false);
});
