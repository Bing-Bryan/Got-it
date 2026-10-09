import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clampPanelWidth, panelDensity, PanelResizeHandle } from './PanelResizeHandle';
let host:HTMLDivElement,root:Root;
const collapse=vi.fn();
const key='got-it.result-panel-width.v1';
function Harness(){const ref=useRef<HTMLElement>(null);return <div className="app-frame"><main className="reader-column"/><aside ref={ref}><PanelResizeHandle panel={ref} onStart={()=>{}} onCollapse={collapse}/></aside></div>;}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.removeItem(key);collapse.mockReset();HTMLElement.prototype.setPointerCapture=vi.fn();host=document.createElement('div');root=createRoot(host);vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return {left:this.className==='reader-column'?236:0,right:1440,width:404,height:900,top:0,bottom:900,x:0,y:0,toJSON(){}};});});
afterEach(async()=>{await act(async()=>root.unmount());vi.restoreAllMocks();localStorage.removeItem(key);});
async function mount(){await act(async()=>root.render(<Harness/>));}
async function press(key:string){await act(async()=>host.querySelector('[role=separator]')!.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));}
it('limits widths and restores a valid preference',async()=>{
 expect(clampPanelWidth(900)).toBe(720);expect(clampPanelWidth(100)).toBe(220);expect(clampPanelWidth(600,460)).toBe(460);
 localStorage.setItem(key,'600');await mount();expect((host.querySelector('.app-frame') as HTMLElement).style.getPropertyValue('--preferred-right-width')).toBe('600px');
});
it('supports keyboard boundaries and restoring the default',async()=>{
 await mount();await press('End');expect(localStorage.getItem(key)).toBe('720');
 await press('Home');expect(localStorage.getItem(key)).toBe('220');
 await press('Enter');expect(localStorage.getItem(key)).toBe('404');
});
it('ignores corrupt storage and remains usable if persistence fails',async()=>{
 localStorage.setItem(key,'broken');await mount();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
 await press('ArrowLeft');expect((host.querySelector('.app-frame') as HTMLElement).style.getPropertyValue('--preferred-right-width')).toBe('420px');
});

it('uses panel width and hysteresis for all three header densities',()=>{
 expect(panelDensity(500)).toBe('full');expect(panelDensity(370)).toBe('counts');
 expect(panelDensity(230)).toBe('icons');expect(panelDensity(248,'icons')).toBe('icons');
 expect(panelDensity(252,'icons')).toBe('counts');expect(panelDensity(385,'counts')).toBe('counts');
 expect(panelDensity(392,'counts')).toBe('full');
});

async function pointer(type:string,x:number){await act(async()=>host.querySelector('[role=separator]')!.dispatchEvent(new MouseEvent(type,{clientX:x,button:0,bubbles:true})));}
it('requires extra travel and release to collapse, restoring the pre-drag preference',async()=>{
 await mount();await pointer('pointerdown',1000);await pointer('pointermove',1200);
 expect(collapse).not.toHaveBeenCalled();expect(host.querySelector('aside')?.dataset.collapsePending).toBe('false');
 await pointer('pointermove',1240);expect(collapse).not.toHaveBeenCalled();
 await pointer('pointerup',1240);expect(collapse).toHaveBeenCalledOnce();expect(localStorage.getItem(key)).toBe('404');
});
it('Escape and pointer cancellation restore width without collapsing',async()=>{
 await mount();await pointer('pointerdown',1000);await pointer('pointermove',1240);await press('Escape');await pointer('pointerup',1240);
 expect(collapse).not.toHaveBeenCalled();expect((host.querySelector('.app-frame') as HTMLElement).style.getPropertyValue('--preferred-right-width')).toBe('404px');
 await pointer('pointerdown',1000);await pointer('pointermove',1240);await pointer('pointercancel',1240);expect(collapse).not.toHaveBeenCalled();
});
