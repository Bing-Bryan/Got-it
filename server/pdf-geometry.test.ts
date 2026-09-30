// @vitest-environment node
import {expect,it} from 'vitest';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pdfFixture} from './test-support/pdf-fixture';
import {originalRect,screenRect} from '../src/lib/pdf-geometry';
import {abortable} from '../src/lib/abortable';
it('round-trips the same original area across PDF rotations, cropped page origins and zoom',async()=>{
 for(const rotation of [0,90,180,270]){const task=getDocument({data:new Uint8Array(pdfFixture(1,rotation,true))});try{const pdf=await task.promise,p=await pdf.getPage(1);for(const scale of [.5,1,1.75,3]){const viewport=p.getViewport({scale});const restored=originalRect(viewport,screenRect(viewport,[70,60,210,200]));for(const [i,n]of restored.entries())expect(n).toBeCloseTo([70,60,210,200][i],6);}}finally{await task.destroy();}}
});
it('settles cancelled and timed-out worker waits even if the worker never responds; late values stay rejected',async()=>{
 const c=new AbortController();let finish!:(v:number)=>void;const work=abortable(new Promise<number>(r=>finish=r),c.signal);c.abort(new Error('识别已取消'));await expect(work).rejects.toThrow('取消');finish(1);await expect(work).rejects.toThrow('取消');
 const t=new AbortController();const timeout=abortable(new Promise(()=>{}),t.signal);t.abort(new Error('识别超过 60 秒'));await expect(timeout).rejects.toThrow('60');
});
