import { describe, expect, it } from 'vitest';
import { createInitialWorkspace as initialWorkspace } from '../sample';
import { loadWorkspace, sanitizeWorkspace, WORKSPACE_STORAGE_KEY } from './storage';
import { workspaceToJson, workspaceToMarkdown } from './export';
import { canCompleteInquiry } from './learning';
import { interruptMessage, readInquiryStream } from './inquiry-stream';
import type { InquiryEvent, InquiryRequest, ThreadMessage, Verification } from '../types';
function createInitialWorkspace() {
 const w=initialWorkspace();w.inquiries.push({id:'i',intent:'why',question:'为什么',anchor:{documentId:w.document.id,blockId:'b',headingPath:[],quote:'原句',prefix:'',suffix:'',start:0,end:2,matchStatus:'matched'},status:'ready',messages:[],understanding:'',createdAt:'now',updatedAt:'now'});return w;
}
const v:Verification={verdict:'insufficient',summary:'没有充分依据',reason:'缺少统一行业样本',readingAdvice:'不要直接引用',claims:[],round:2,scope:'expanded',parentMessageId:'old',completion:'complete',changeNote:'本轮没有新增可靠依据'};
const message:ThreadMessage={id:'new',role:'assistant',content:v.summary,createdAt:'now',verification:v,operation:'verify',scope:'expanded',round:2,completion:'complete',sources:[{id:'s',title:'研究',url:'https://example.org',domain:'example.org',reliability:'strong',reliabilityReasons:['原始样本与方法'],scope:'18–25样本',applicability:'background',differences:['不是行业统计']}]};
const request:InquiryRequest={providerId:'demo',intent:'verify',operation:'verify',scope:'expanded',round:2,quote:'原句',context:'',documentTitle:'',question:'查证',history:[],requestId:'new'};
function transport(events: unknown[], pieces = 11): typeof fetch {
 const bytes=new TextEncoder().encode(events.map(e=>JSON.stringify(e)).join('\n')+'\n');
 return (async()=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=pieces)c.enqueue(bytes.slice(i,i+pieces));c.close();}}))) as typeof fetch;
}
describe('review persistence and lifecycle',()=>{
 it('round-trips old why and new rounds using a safe projection',()=>{
  const w=createInitialWorkspace();const i=w.inquiries[0];i.intent='why';i.messages.push({...message,secret:'secret-token',verification:{...v,rawLog:'secret-log'},sources:[{...message.sources![0],html:'secret-body'}]} as unknown as ThreadMessage);i.status='understood';
  const json=workspaceToJson(w);expect(json).not.toMatch(/secret-token|secret-log|secret-body/);
  const restored=loadWorkspace({getItem:()=>json,setItem:()=>{},removeItem:()=>{}})!;
  expect(restored.inquiries[0]).toMatchObject({intent:'why',status:'understood'});
  expect(restored.inquiries[0].messages.at(-1)?.verification).toEqual(v);
  const md=workspaceToMarkdown(w);for(const value of ['第 2 轮','没有充分依据','不要直接引用','原始样本与方法','18–25样本','不是行业统计','expanded'])expect(md).toContain(value);
 });
 it('restores running/provisional as interrupted without locking or calling a provider',()=>{
  const w=createInitialWorkspace();w.inquiries[0].status='answering';w.inquiries[0].messages.push({...message,completion:'provisional',verification:{...v,completion:'provisional'}});
  const restored=loadWorkspace({getItem:key=>key===WORKSPACE_STORAGE_KEY?JSON.stringify(w):null,setItem:()=>{},removeItem:()=>{}})!;
  expect(restored.inquiries[0].status).toBe('ready');expect(restored.inquiries[0].lastError).toContain('中断');
  expect(restored.inquiries[0].messages.at(-1)?.verification).toMatchObject({completion:'interrupted',verdict:'incomplete'});
  expect(canCompleteInquiry(restored.inquiries[0])).toBe(false);
 });
 it('learning closure preserves insufficient evidence and blocks incomplete latest reply',()=>{
  const w=createInitialWorkspace(),i=w.inquiries[0];i.messages=[message];i.status='ready';expect(canCompleteInquiry(i)).toBe(true);
  i.status='understood';expect(i.messages[0].verification?.verdict).toBe('insufficient');
  i.messages.push({...message,completion:'provisional'});expect(canCompleteInquiry(i)).toBe(false);
  i.messages[1]=interruptMessage(i.messages[1]);expect(canCompleteInquiry(i)).toBe(false);
  expect(sanitizeWorkspace(w).inquiries[0].messages[1].completion).toBe('interrupted');
 });
 it('isolates request IDs, out of order, late complete and chunked unicode',async()=>{
  const events:Partial<InquiryEvent>[]=[{requestId:'old',sequence:99,type:'complete'},{requestId:'new',sequence:2,type:'progress',progress:'search-started'},{requestId:'new',sequence:1,type:'progress',progress:'accepted'},{requestId:'new',sequence:3,type:'complete',response:{answer:'中文结果',sources:[],evidenceStatus:'partial',providerId:'demo',providerName:'演示',mode:'demo'}},{requestId:'new',sequence:4,type:'progress',progress:'search-started'}];
  const received:InquiryEvent[]=[];await readInquiryStream(request,e=>received.push(e),undefined,transport(events));expect(received.map(e=>e.sequence)).toEqual([2,3]);expect(received[1].response?.answer).toBe('中文结果');
 });
 it('disconnect preserves delivered preliminary but never reports success; retry receives only its own completion',async()=>{
  const events=[{requestId:'new',sequence:1,type:'preliminary',response:{answer:'暂定中文'}}];let count=0;
  await expect(readInquiryStream(request,()=>count++,undefined,transport(events))).rejects.toThrow('中断');expect(count).toBe(1);
  await expect(readInquiryStream({...request,requestId:'retry'},()=>{},undefined,transport(events))).rejects.toThrow('中断');
 });
});

it('surfaces structured API errors instead of hiding request validation failures',async()=>{
 const request={requestId:'r',providerId:'codex' as const,intent:'explain' as const,quote:'x',question:'x',context:'',documentTitle:'',history:[]};
 await expect(readInquiryStream(request,()=>{},undefined,async()=>new Response(JSON.stringify({error:'content 不能为空'}),{status:400}))).rejects.toThrow('content 不能为空');
});
it('reads byte-split body deltas and preserves partial text on disconnect',async()=>{
 const received:InquiryEvent[]=[];
 await expect(readInquiryStream(request,e=>received.push(e),undefined,transport([{requestId:'new',sequence:1,type:'answer-delta',delta:'中文🌱'},{requestId:'old',sequence:2,type:'answer-delta',delta:'错误内容'}],1))).rejects.toThrow('中断');
 expect(received.map(e=>e.delta)).toEqual(['中文🌱']);
});
