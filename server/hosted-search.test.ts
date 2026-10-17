import {describe,expect,it,vi} from 'vitest';
import {createBochaSearch,parseBochaResponse,SEARCH_LIMITS} from './hosted-search';
const item={name:'Original research',url:'https://example.org/study',snippet:'short summary',summary:'longer summary',datePublished:'2026-10-16'};
describe('Bocha official adapter, controlled responses only',()=>{
 it('posts one fixed authenticated bounded search and supports documented data envelope',async()=>{
  const calls:unknown[]=[];const search=createBochaSearch('fixture-secret','https://api.bocha.cn',async(url,init)=>{calls.push({url,init});return Response.json({code:200,data:{webPages:{value:[item]}}});});
  const results=await search('a reading claim',new AbortController().signal);expect(results[0]).toMatchObject({id:'source-1',title:item.name,summary:item.summary,publishedAt:item.datePublished});
  expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({url:'https://api.bocha.cn/v1/web-search',init:{method:'POST',redirect:'error'}});const sent=calls[0] as {init:RequestInit};expect(JSON.parse(sent.init.body as string)).toEqual({query:'a reading claim',freshness:'noLimit',summary:true,count:5});
 });
 it('accepts website unwrapped result but bounds and deduplicates candidates and fields',()=>{
  const found=parseBochaResponse({webPages:{value:[{...item,summary:'中'.repeat(5000)},item,{...item,url:'file:///etc/passwd'},{...item,url:'https://username:password@example.org/secret'},{...item,url:'https://example.org:8443/blocked'},...Array.from({length:8},(_,i)=>({...item,url:`https://example.org/${i}`}))]}});
  expect(found).toHaveLength(5);expect(Buffer.byteLength(found[0].summary)).toBeLessThanOrEqual(SEARCH_LIMITS.summaryBytes);expect(new Set(found.map(x=>x.url)).size).toBe(5);
 });
 it('rejects unknown endpoints, query limits, provider error codes and malformed bodies without fallback',async()=>{
  expect(()=>createBochaSearch('fixture','https://evil.example')).toThrow();let calls=0;
  for(const response of [Response.json({code:403,message:'secret context'}),Response.json({data:{unexpected:[]}}),new Response('malformed'),new Response('upstream secret',{status:500})]){
   const search=createBochaSearch('fixture',undefined,async()=>{calls++;return response;});await expect(search('a claim',new AbortController().signal)).rejects.toMatchObject({code:'search_failed'});
  }
  expect(calls).toBe(4);const fn=vi.fn<typeof fetch>();const bounded=createBochaSearch('fixture',undefined,fn);await expect(bounded('x'.repeat(257),new AbortController().signal)).rejects.toMatchObject({code:'query_limit'});expect(fn).not.toHaveBeenCalled();
 });
 it('rejects oversized responses and propagates cancellation',async()=>{
  const big=createBochaSearch('fixture',undefined,async()=>new Response('x'.repeat(SEARCH_LIMITS.responseBytes+1)));await expect(big('claim',new AbortController().signal)).rejects.toMatchObject({code:'search_failed'});
  const controller=new AbortController();controller.abort(new Error('explicit stop'));const fetcher=vi.fn<typeof fetch>();await expect(createBochaSearch('fixture',undefined,fetcher)('claim',controller.signal)).rejects.toThrow('explicit stop');expect(fetcher).not.toHaveBeenCalled();
 });
});
