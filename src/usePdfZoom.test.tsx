import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { usePdfZoom, sliderZoom, zoomSlider, pageBaseWidth } from './usePdfZoom';
import { PdfZoomControls } from './PdfZoomControls';
let host:HTMLDivElement, root:Root, api:ReturnType<typeof usePdfZoom>, resize:()=>void;
const page={view:[0,0,400,300] as [number,number,number,number],rotation:0};
function Harness({id='a'}:{id?:string}) {const ref=useRef<HTMLDivElement>(null);api=usePdfZoom(ref,id,page);return <div ref={ref}><PdfZoomControls scale={api.scale} automatic={api.manual===null} onChange={api.change}/><div className="pdf-page">content</div></div>;}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 vi.stubGlobal('ResizeObserver',class {constructor(cb:()=>void){resize=cb;}observe(){}disconnect(){}});
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(840);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('maps slider evenly by scale factor and respects rotated page sizes',()=>{
 expect(sliderZoom(0)).toBe(.25);expect(sliderZoom(500)).toBe(1);expect(sliderZoom(1000)).toBe(4);
 expect(sliderZoom(zoomSlider(1.3))).toBeCloseTo(1.3);expect(pageBaseWidth({...page,rotation:90})).toBe(300);
});
it('keeps manual scale through resizing, restores automatic mode, and separates document preferences',async()=>{
 await act(async()=>root.render(<Harness/>));expect(api.manual).toBeNull();expect(api.scale).toBe(2);
 await act(async()=>api.change(1.25));vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(440);
 await act(async()=>resize());expect(api.scale).toBe(1.25);expect(api.widthFor(page)).toBe(500);
 await act(async()=>root.render(<Harness key="b" id="b"/>));expect(api.manual).toBeNull();expect(api.scale).toBe(1);
 await act(async()=>root.render(<Harness key="a"/>));expect(api.scale).toBe(1.25);
 await act(async()=>api.change(null));expect(api.scale).toBe(1);expect(localStorage.getItem('got-it.pdf-zoom.v1.a')).toBeNull();
});
it('rejects invalid persisted values and works without writable storage',async()=>{
 localStorage.setItem('got-it.pdf-zoom.v1.a','Infinity');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('denied');});
 await act(async()=>root.render(<Harness/>));expect(api.manual).toBeNull();
 await act(async()=>api.change(100));expect(api.scale).toBe(4);
 await act(async()=>api.change(Number.NaN));expect(api.scale).toBe(4);
 await act(async()=>api.change(.1));expect(api.scale).toBe(.25);
});
it('only consumes modified wheels in document content, and Safari gestures do not apply twice',async()=>{
 await act(async()=>root.render(<Harness/>));const content=host.querySelector('.pdf-page')!;
 const wheel=(options:WheelEventInit)=>new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-20,...options});
 const ordinary=wheel({});await act(async()=>content.dispatchEvent(ordinary));expect(ordinary.defaultPrevented).toBe(false);expect(api.manual).toBeNull();
 const input=wheel({ctrlKey:true});await act(async()=>host.querySelector('input')!.dispatchEvent(input));expect(input.defaultPrevented).toBe(false);
 const modified=wheel({ctrlKey:true});await act(async()=>content.dispatchEvent(modified));expect(modified.defaultPrevented).toBe(true);expect(api.scale).toBeGreaterThan(2);
 const start=new Event('gesturestart',{bubbles:true,cancelable:true});await act(async()=>content.dispatchEvent(start));const before=api.scale;
 await act(async()=>content.dispatchEvent(wheel({ctrlKey:true})));expect(api.scale).toBe(before);
 const move=new Event('gesturechange',{bubbles:true,cancelable:true});Object.assign(move,{scale:1.2});await act(async()=>content.dispatchEvent(move));expect(api.scale).toBeCloseTo(before*1.2);
 await act(async()=>content.dispatchEvent(new Event('gestureend',{bubbles:true})));
});
async function fill(value:string){const input=host.querySelector<HTMLInputElement>('[aria-label="原文缩放百分比"]')!;await act(async()=>{input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});return input;}
it('commits precise input, clamps bounds, and cancels invalid values and Escape',async()=>{
 await act(async()=>root.render(<Harness/>));let input=await fill('137.5');await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(api.scale).toBe(1.375);
 input=await fill('999');await act(async()=>input.blur());expect(api.scale).toBe(4);
 input=await fill('oops');await act(async()=>input.blur());expect(api.scale).toBe(4);expect(input.value).toBe('400');
 input=await fill('50');await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await act(async()=>input.blur());expect(api.scale).toBe(4);
});
it('closes the compact panel with Escape and returns focus to its trigger',async()=>{
 await act(async()=>root.render(<Harness/>));const button=host.querySelector<HTMLButtonElement>('.pdf-zoom-trigger')!;
 await act(async()=>button.click());expect(button.getAttribute('aria-expanded')).toBe('true');
 await act(async()=>host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(button.getAttribute('aria-expanded')).toBe('false');expect(document.activeElement).toBe(button);
});
