import { afterEach, expect, it, vi } from 'vitest';
import { requestDeadline } from './request-deadline';
import { readInquiryStream } from './inquiry-stream';
import type { InquiryRequest } from '../types';
vi.mock('./library-session',()=>({librarySession:async()=> 'synthetic-session'}));
afterEach(()=>vi.useRealTimers());
it('rejects late events after a wall clock jump without waiting for timer dispatch',async()=>{
 vi.useFakeTimers();const d=requestDeadline(100);vi.setSystemTime(Date.now()+5000);expect(()=>d.check()).toThrow('超时');await expect(d.wait(Promise.resolve('late'))).rejects.toThrow('超时');d.dispose();expect(vi.getTimerCount()).toBe(0);
});
it('settles uncooperative work on user cancellation and clears timers',async()=>{
 const c=new AbortController(),d=requestDeadline(1000,c.signal);const p=d.wait(new Promise(()=>{}));c.abort();await expect(p).rejects.toThrow('中断');d.dispose();
});
it.each([false,true])('stream preserves partial data and expires a stuck reader (image=%s)',async(image)=>{
 const request:InquiryRequest={providerId:'codex',intent:'explain',quote:'x',question:'x',context:'',documentTitle:'',history:[],requestId:'r',...(image?{image:{entryId:'entry',fileHash:'a'.repeat(64),cropId:'b'.repeat(64)}}:{})};
 const encode=(e:object)=>new TextEncoder().encode(JSON.stringify({requestId:'r',...e})+'\n');
 const fetcher=async()=>new Response(new ReadableStream({start(c){c.enqueue(encode({sequence:1,type:'progress',progress:'accepted',deadlineAt:Date.now()-950}));c.enqueue(encode({sequence:2,type:'answer-delta',delta:'部分内容'}));}}));
 const events:any[]=[];await expect(readInquiryStream(request,e=>events.push(e),undefined,fetcher)).rejects.toThrow('超时');expect(events.at(-1).delta).toBe('部分内容');expect(events.some(e=>e.type==='complete')).toBe(false);
});

it('image stream sends only authorized references, stops promptly and ignores delayed completion',async()=>{
 const image={entryId:'entry',fileHash:'a'.repeat(64),cropId:'b'.repeat(64)};const request:InquiryRequest={providerId:'codex',intent:'explain',quote:'region',question:'explain',context:'',documentTitle:'',history:[],requestId:'r',image};const events:unknown[]=[];const c=new AbortController();let received!:ReadableStreamDefaultController<Uint8Array>;
 const fetcher=vi.fn(async(_input:unknown,init?:RequestInit)=>{expect((init!.headers as Record<string,string>)['X-Got-It-Session']).toBe('synthetic-session');expect(JSON.parse(init!.body as string).image).toEqual(image);return new Response(new ReadableStream<Uint8Array>({start(controller){received=controller;controller.enqueue(new TextEncoder().encode(JSON.stringify({requestId:'r',sequence:1,type:'answer-delta',delta:'partial'})+'\n'));}}));});
 const work=readInquiryStream(request,e=>events.push(e),c.signal,fetcher);await vi.waitFor(()=>expect(events).toHaveLength(1));c.abort();await expect(work).rejects.toThrow('中断');expect(()=>received.enqueue(new TextEncoder().encode('late'))).toThrow();expect(events).toHaveLength(1);
});
