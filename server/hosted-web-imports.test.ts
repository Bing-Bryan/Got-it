// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readdirSync,rmSync,chmodSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {HostedResourceTickets} from './hosted-resource-tickets';
import {HostedWebImports} from './hosted-web-imports';import {WEB_LIMITS} from './web-fetch';
import {webFixture,WEB_URL} from './test-support/web-fixture';
const token='a'.repeat(64),other='b'.repeat(64),dirs:string[]=[];
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
function state(){const dir=mkdtempSync(join(tmpdir(),'hosted-import-test-'));dirs.push(dir);return {dir,tickets:new HostedResourceTickets(join(dir,'state'))};}
async function ready(jobs:HostedWebImports,owner='owner',op='op'){for(let i=0;i<100;i++){const s=jobs.status(owner,op,token);if(s.status!=='reading')return s;await new Promise(r=>setTimeout(r,2));}throw new Error('job stuck');}
describe('hosted ephemeral import and signed resource boundary',()=>{
 it('survives signing-key restart, rejects forged/context-altered tickets and fails closed on invalid key permissions',()=>{
  const {dir,tickets}=state(),value={v:1 as const,documentId:'doc',contentVersion:'a'.repeat(64),mediaId:'media',sourceUrl:'https://example.org/image.png',extractorVersion:'static'};
  const ticket=tickets.sign(value);expect(new HostedResourceTickets(join(dir,'state')).verify(ticket)).toEqual(value);expect(()=>tickets.verify(ticket.slice(0,-5)+'xxxxx')).toThrow();
  const [payload,sig]=ticket.split('.'),forged=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(payload,'base64url').toString()),sourceUrl:'http://127.0.0.1/secret'})).toString('base64url')+'.'+sig;expect(()=>tickets.verify(forged)).toThrow();
  chmodSync(join(dir,'state/resource-signing.key'),0o644);expect(()=>new HostedResourceTickets(join(dir,'state'))).toThrow('invalid');
 });
 it('keeps one immutable owner/token preview with hash-bound bytes, signed retry metadata and no content files',async()=>{
  const {dir,tickets}=state(),jobs=new HostedWebImports(tickets,{extractor:async()=>webFixture()});
  await jobs.start('owner','ip',token,{url:WEB_URL,operationId:'op'});const s=await ready(jobs);expect(s.status).toBe('ready');const doc=s.preview!.workspace.document;if(doc.kind!=='web')throw new Error();const media=doc.web.media[0];expect(jobs.resource('owner','op',token,media.resourceId!).mime).toBe('image/png');expect(s.preview!.retryTickets?.[media.id]).toBeTruthy();
  expect(()=>jobs.status('owner','op',other)).toThrow('不属于');expect(()=>jobs.status('other','op',token)).toThrow('不存在');expect(()=>jobs.resource('owner','op',token,'https://example.org/arbitrary')).toThrow();
  expect(readdirSync(join(dir,'state'))).toEqual(['resource-signing.key']);expect(readFileSync(join(dir,'state/resource-signing.key')).length).toBe(32);
  jobs.release('owner','op',token);expect(jobs.memoryBytes).toBe(0);expect(()=>jobs.status('owner','op',token)).toThrow();
 });
 it('does not revive a cancelled/expired candidate after late completion and retains reservations until extractor settles',async()=>{
  const {tickets}=state();let finish!:(v:Awaited<ReturnType<typeof webFixture>>)=>void,now=1000;const pending=new Promise<Awaited<ReturnType<typeof webFixture>>>(r=>finish=r);
  const jobs=new HostedWebImports(tickets,{extractor:async()=>pending,clock:()=>now,memoryLimit:WEB_LIMITS.totalBytes});
  await jobs.start('owner','ip',token,{url:WEB_URL,operationId:'op'});jobs.cancel('owner','op',token);expect(jobs.memoryBytes).toBe(WEB_LIMITS.totalBytes);
  await expect(jobs.start('other','ip',token,{url:WEB_URL,operationId:'next'})).rejects.toMatchObject({code:'web_memory_limit'});
  finish(await webFixture());await new Promise(r=>setTimeout(r,10));expect(jobs.status('owner','op',token).status).toBe('cancelled');expect(jobs.memoryBytes).toBe(0);
  await jobs.start('owner','ip',token,{url:WEB_URL,operationId:'new'});now+=WEB_LIMITS.previewMs+1;expect(()=>jobs.status('owner','new',token)).toThrow('过期');
 });
 it('rejects arbitrary capture fields, concurrency/memory overcommit and invalid retry tickets before fetching',async()=>{
  const {tickets}=state();let calls=0;const jobs=new HostedWebImports(tickets,{extractor:async()=>new Promise(()=>{}),fetcher:async()=>{calls++;throw new Error('must not fetch');},memoryLimit:WEB_LIMITS.totalBytes*2});
  await jobs.start('a','ip',token,{url:WEB_URL,operationId:'one'});await jobs.start('b','ip',token,{url:WEB_URL,operationId:'two'});expect(jobs.memoryBytes).toBe(WEB_LIMITS.totalBytes*2);
  await expect(jobs.start('c','ip',token,{url:WEB_URL,operationId:'three'})).rejects.toMatchObject({code:'web_memory_limit'});
  await expect(jobs.start('d','ip',token,{capture:{cookie:'PRIVATE'},operationId:'capture'},true)).rejects.toThrow();
  await expect(jobs.retry('a','ip',token,{operationId:'retry',ticket:'bad'},new AbortController().signal)).rejects.toMatchObject({code:'web_ticket_invalid'});expect(calls).toBe(0);
  jobs.cancel('a','one',token);jobs.cancel('b','two',token);
 });
 it('enforces sequential browser/IP daily network limits even after jobs are released',async()=>{
  const {tickets}=state(),data=await webFixture(),jobs=new HostedWebImports(tickets,{extractor:async()=>structuredClone(data)});
  for(let i=0;i<60;i++){const owner=i<30?'first':'second',op='operation-'+i;await jobs.start(owner,'same-ip',token,{url:WEB_URL,operationId:op});await ready(jobs,owner,op);jobs.release(owner,op,token);}
  await expect(jobs.start('first','new-ip',token,{url:WEB_URL,operationId:'browser-over'})).rejects.toMatchObject({code:'web_rate_limit'});
  await expect(jobs.start('fresh','same-ip',token,{url:WEB_URL,operationId:'ip-over'})).rejects.toMatchObject({code:'web_rate_limit'});
  expect(jobs.memoryBytes).toBe(0);
 });
 it('only retries signed public original media, explicitly disables proxy and returns verified bytes without modifying original',async()=>{
  const {tickets}=state(),fixture=await webFixture();const doc=fixture.workspace.document;if(doc.kind!=='web')throw new Error();const media=doc.web.media[0],image=fixture.resources.get(media.resourceId!)!;let fetched=0;
  const ticket=tickets.sign({v:1,documentId:doc.id,contentVersion:doc.web.contentVersion,mediaId:media.id,sourceUrl:media.sourceUrl!,extractorVersion:doc.web.extractorVersion});
  const jobs=new HostedWebImports(tickets,{fetcher:async(url,options)=>{fetched++;expect(options.disableProxy).toBe(true);expect(options.resolver).toBeTypeOf('function');return {url,type:image.mime,bytes:image.bytes};}});
  const result=await jobs.retry('owner','ip',token,{operationId:'retry',ticket},new AbortController().signal);expect(result.documentId).toBe(doc.id);expect(result.media.resourceId).toBe(media.resourceId);expect(Buffer.from(result.resource.base64,'base64').equals(image.bytes)).toBe(true);expect(fetched).toBe(1);expect(jobs.memoryBytes).toBe(0);
 });
});
