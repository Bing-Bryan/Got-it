// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import type {Server} from 'node:http';
import {createHostedApp} from './hosted-api';import {HostedBudget,initializeBudget} from './hosted-budget';import {HostedWebImports} from './hosted-web-imports';import {HostedResourceTickets} from './hosted-resource-tickets';import {HostedTranslations} from './hosted-translations';import {webFixture,WEB_URL} from './test-support/web-fixture';import {TRANSLATION_QUALITY_VERSION} from '../src/lib/web-translation';
const origin='https://gotit.example',owner='12345678-1234-4123-8123-123456789012',second='12345678-1234-4123-8123-123456789013',token='a'.repeat(64);const cleanup:Array<()=>unknown>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function setup(){const dir=mkdtempSync(join(tmpdir(),'hosted-content-api-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'budget.json');initializeBudget(path);const budget=new HostedBudget(path);cleanup.push(()=>budget.close());const imports=new HostedWebImports(new HostedResourceTickets(join(dir,'state')),{extractor:async()=>webFixture()});let calls=0;const translations=new HostedTranslations(budget,async()=>{calls++;return {data:{translations:{unit:'有用的短语。'}},usage:{prompt_tokens:100,completion_tokens:40}};});
 const server=createHostedApp({origin,budget,webImports:imports,translations}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));cleanup.push(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/hosted`;
 const headers=(id=owner,opToken=token)=>({Origin:origin,'X-Trial-Id':id,'X-Hosted-Operation-Token':opToken,'Content-Type':'application/json'});
 const request=(path:string,body?:unknown,h=headers())=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:h,...(body===undefined?{}:{body:JSON.stringify(body)})});return {request,headers,imports,calls:()=>calls};}
describe('hosted content-only routes preserve origin, capabilities and parser bounds',()=>{
 it('serves only validated ephemeral preview resources and denies other identities/tokens and local library paths',async()=>{
  const f=await setup();expect((await f.request('/web-imports',{operationId:'op',url:WEB_URL})).status).toBe(200);let job:any;for(let i=0;i<100;i++){job=await(await f.request('/web-imports/op')).json();if(job.status!=='reading')break;await new Promise(r=>setTimeout(r,2));}expect(job.status).toBe('ready');const media=job.preview.workspace.document.web.media[0];
  const image=await f.request('/web-imports/op/resources/'+media.resourceId);expect(image.status).toBe(200);expect(image.headers.get('content-type')).toBe('image/png');expect(image.headers.get('x-content-type-options')).toBe('nosniff');
  expect((await f.request('/web-imports/op',undefined,f.headers(second))).status).toBe(404);expect((await f.request('/web-imports/op',undefined,f.headers(owner,'b'.repeat(64)))).status).toBe(403);
  expect((await f.request('/web-imports/op',undefined,{...f.headers(),Origin:'https://evil.example'})).status).toBe(403);expect((await f.request('/library')).status).toBe(404);
  expect((await f.request('/web-imports/op/cancel',{url:'http://127.0.0.1'})).status).toBe(400);expect((await f.request('/web-imports/op/cancel',{})).status).toBe(200);expect((await f.request('/web-imports/op/resources/'+media.resourceId)).status).toBe(404);expect(f.calls()).toBe(0);
 });
 it('does not widen inquiry/usage bodies while allowing bounded capture and translation envelopes',async()=>{
  const f=await setup(),large='x'.repeat(50_000);expect((await f.request('/inquiry/stream',{quote:large})).status).toBe(413);expect((await f.request('/usage',{noise:large})).status).toBe(413);
  expect((await f.request('/x-article-imports',{operationId:'capture',capture:{text:large}})).status).toBe(400);expect((await f.request('/translation-batches',{noise:large})).status).toBe(400);expect(f.calls()).toBe(0);
  expect((await f.request('/web-media/retry',{operationId:'retry',ticket:'fake',url:'http://127.0.0.1'})).status).toBe(400);
 });
 it('returns truthful translation result only after validation and binds cancel capability',async()=>{
  const f=await setup();const r=await f.request('/translation-batches',{qualityVersion:TRANSLATION_QUALITY_VERSION,operationId:'translate',translationId:'translation',sourceVersion:'f'.repeat(64),units:[{id:'unit',blockId:'block',text:'A useful phrase.'}]});expect(r.status).toBe(200);expect(await r.json()).toMatchObject({providerId:'deepseek',modelConfig:{model:'deepseek-flash',reasoningEffort:'none'},units:{unit:'有用的短语。'}});expect(f.calls()).toBe(1);
  expect((await f.request('/translation-batches/translate/cancel',{},f.headers(owner,'b'.repeat(64)))).status).toBe(403);
 });
});
