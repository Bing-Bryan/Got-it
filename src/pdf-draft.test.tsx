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
const button=(n:number,label:string)=>[...sheet(n).querySelectorAll<HTMLButtonElement>('.pdf-draft-switch button')].find(b=>b.textContent!.startsWith(label))!;

it('shows no draft switch and reads no text layer without a saved translation',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]}/>));
 expect(host.querySelector('.pdf-draft-switch')).toBeNull();expect(mocks.loads).toBe(0);
});

it('switches one page to its Chinese draft while the original page stays mounted and unchanged',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation}/>));
 expect(button(1,'原页').getAttribute('aria-pressed')).toBe('true');expect(sheet(1).querySelector('.pdf-draft')).toBeNull();
 expect(button(1,'中文稿').textContent).toBe('中文稿（部分）');expect(button(2,'中文稿').textContent).toBe('中文稿（未译）');
 await act(async()=>button(1,'中文稿').click());
 const draft=sheet(1).querySelector('.pdf-draft')!;
 expect([...draft.querySelectorAll('.pdf-draft-paragraph')].map(p=>p.textContent)).toEqual(['第一页第一段译文。','未译Second synthetic paragraph on page one.']);
 expect(sheet(1).querySelector<HTMLElement>('.pdf-page-wrap')!.hidden).toBe(true);expect(sheet(1).querySelector('canvas')).not.toBeNull();
 expect(sheet(2).querySelector('.pdf-draft')).toBeNull();
 await act(async()=>button(1,'原页').click());
 expect(sheet(1).querySelector('.pdf-draft')).toBeNull();expect(sheet(1).querySelector<HTMLElement>('.pdf-page-wrap')!.hidden).toBe(false);
});

it('tells the reader an image-only page cannot be translated instead of showing it as done or failed',async()=>{
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation}/>));
 await act(async()=>button(3,'中文稿').click());
 expect(sheet(3).querySelector('.pdf-draft-notice')!.textContent).toBe('此页为图片，暂不能全文翻译，可框选后提问');
 expect(sheet(3).querySelectorAll('.pdf-draft-paragraph')).toHaveLength(0);
});

it('turns a Chinese-draft selection into a sticky anchored to the original paragraph without sending anything on its own',async()=>{
 Range.prototype.getClientRects=function(){return [{left:10,top:10,right:60,bottom:24,width:50,height:14}] as unknown as DOMRectList;};
 Range.prototype.getBoundingClientRect=function(){return {left:10,top:10,right:60,bottom:24,width:50,height:14} as DOMRect;};
 const onCreate=vi.fn();
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} onCreate={onCreate}/>));
 await act(async()=>button(1,'中文稿').click());
 const text=sheet(1).querySelector('[data-pdf-paragraph="pdf-p1-b0"] .pdf-draft-text')!.firstChild!;
 const range=document.createRange();range.setStart(text,3);range.setEnd(text,6);
 window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
 await act(async()=>{sheet(1).querySelector('.pdf-draft')!.dispatchEvent(new Event('pointerup',{bubbles:true}));});
 expect(onCreate).not.toHaveBeenCalled();
 const card=sheet(1).querySelector('.pdf-selection-card')!;expect(card.textContent).toContain('第一段');
 await act(async()=>(card.querySelector('[data-intent="explain"]') as HTMLButtonElement).click());
 const [intent,draft]=onCreate.mock.calls[0];
 expect(intent).toBe('explain');
 expect(draft.anchor).toMatchObject({blockId:'pdf-p1-b0',quote:'First synthetic paragraph on page one.',pdf:{kind:'text',source:'native',fileHash:hash,page:1,rects:[[40,200,300,212]]},translation:{translationId:'t',sourceVersion:source.sourceVersion,blockId:'pdf-p1-b0',quote:'第一段',start:3,end:6}});
 expect(draft.context).toContain('译文选区：第一段');expect(draft.context).toContain('对应原文段落（非逐词对齐）：First synthetic paragraph on page one.');
 expect(draft.context).not.toContain('page two');
});

it('asks for a smaller selection when it spans two draft paragraphs',async()=>{
 const onCreate=vi.fn();
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={translation} onCreate={onCreate}/>));
 await act(async()=>button(1,'中文稿').click());
 const a=sheet(1).querySelector('[data-pdf-paragraph="pdf-p1-b0"] .pdf-draft-text')!.firstChild!,b=sheet(1).querySelector('[data-pdf-paragraph="pdf-p1-b1"] .pdf-draft-text')!.firstChild!;
 const range=document.createRange();range.setStart(a,1);range.setEnd(b,3);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
 await act(async()=>{sheet(1).querySelector('.pdf-draft')!.dispatchEvent(new Event('pointerup',{bubbles:true}));});
 expect(sheet(1).querySelector('.pdf-selection-card')).toBeNull();expect(sheet(1).textContent).toContain('请在中文稿的同一段内选择文字。');
});

it('locates a draft sticky in the Chinese draft and other stickies on the original page',async()=>{
 vi.stubGlobal('CSS',{escape:(s:string)=>s});
 const draftSticky={id:'d',intent:'explain',question:'q',status:'ready',createdAt:'2026',updatedAt:'2026',understanding:'',messages:[],anchor:{documentId:'doc',blockId:'pdf-p1-b0',headingPath:['第 1 页'],quote:'First synthetic paragraph on page one.',prefix:'',suffix:'',start:0,end:38,matchStatus:'matched',translation:{version:2,translationId:'t',sourceVersion:source.sourceVersion,blockId:'pdf-p1-b0',quote:'第一段',prefix:'',suffix:'',start:3,end:6},pdf:{kind:'text',source:'native',fileHash:hash,page:1,rects:[[40,200,300,212]]}}} as import('./types').Inquiry;
 const onLocated=vi.fn(),props={document:pdf,entryId:'entry',inquiries:[draftSticky],translation,onLocated};
 await act(async()=>root.render(<PdfReader {...props}/>));
 await act(async()=>button(1,'中文稿').click());
 await act(async()=>root.render(<PdfReader {...props} target={{id:'d',nonce:1}}/>));
 expect(sheet(1).querySelector('.pdf-draft')).not.toBeNull();
 expect(onLocated).toHaveBeenCalledWith('d',expect.any(Boolean),undefined,sheet(1).querySelector('[data-pdf-paragraph="pdf-p1-b0"]'));
 const plain={...draftSticky,id:'o',anchor:{...draftSticky.anchor,translation:undefined}};
 await act(async()=>root.render(<PdfReader {...props} inquiries={[draftSticky,plain]} target={{id:'o',nonce:2}}/>));
 expect(sheet(1).querySelector('.pdf-draft')).toBeNull();
 // The finished jump does not lock the page: the reader can open the draft again.
 await act(async()=>button(1,'中文稿').click());
 expect(sheet(1).querySelector('.pdf-draft')).not.toBeNull();expect(button(1,'中文稿').getAttribute('aria-pressed')).toBe('true');
});

it('refuses a draft selection whose paragraph has no valid position on the original page',async()=>{
 const broken=pdfSourceFromPages([{page:1,scanned:false,paragraphs:[{id:'pdf-p1-b0',page:1,text:'First synthetic paragraph on page one.',rects:[]}]}],hash);
 mocks.override=broken;
 const onCreate=vi.fn();
 await act(async()=>root.render(<PdfReader document={pdf} entryId="entry" inquiries={[]} translation={{...translation,sourceVersion:broken.sourceVersion}} onCreate={onCreate}/>));
 await act(async()=>button(1,'中文稿').click());
 const text=sheet(1).querySelector('[data-pdf-paragraph="pdf-p1-b0"] .pdf-draft-text')!.firstChild!;
 const range=document.createRange();range.setStart(text,0);range.setEnd(text,3);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
 await act(async()=>{sheet(1).querySelector('.pdf-draft')!.dispatchEvent(new Event('pointerup',{bubbles:true}));});
 expect(sheet(1).querySelector('.pdf-selection-card')).toBeNull();expect(sheet(1).textContent).toContain('此段无法对应到原页位置');
 mocks.override=null;
});
