// Local, explicitly controlled UI fixture. Never used by the application.
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';
import { ProviderService } from '../server/providers.ts';
import { ReadingLibrary } from '../server/reading-library.ts';
import { testModelCatalog } from '../server/test-support/model-catalog.ts';
import { readingFixture } from '../src/test-support/recovery-fixture.ts';
if(!process.argv.includes('--run')){console.log('Opt-in controlled fixture: --run');process.exit(0);}
let mode='complete';
const dir=await mkdtemp(join(tmpdir(),'got-it-controlled-explanation-'));const library=new ReadingLibrary(dir);
const w=readingFixture('受控界面验收.md');w.document.markdown='# 受控界面验收\n\n阅读内容';w.activeInquiryId='i';w.activeProviderId='codex';w.inquiries[0].messages[0].mode='live';
const e=await library.add(w,'controlled');await library.activate(e.id);
const service=new ProviderService({modelCatalog:testModelCatalog,codexTimeoutMs:1800,execFileImpl:async()=>({stdout:'Logged in',stderr:''}),codexTurnImpl:async o=>{
 if(mode==='fail')throw new Error('Controlled failure');
 o.onDelta('受控验收：已收到的部分正文。');
 if(mode==='stall')await new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));
 const raw=JSON.stringify({answer:'受控验收：补充回答已完成。',sources:[{id:'s',title:'受控公开样例',url:'https://example.org/definition',snippet:'This is a controlled quotation for UI testing.'}],verification:null,evidenceStatus:'not-applicable'});
 const trace=[{type:'turn.started'},{type:'item.completed',item:{id:'s',type:'web_search',action:{type:'search',query:'controlled'},status:'completed'}},{type:'turn.completed'}].map(JSON.stringify).join('\n');return {raw,trace};
},sourceReader:async url=>({url,text:'This is a controlled quotation for UI testing.'})});
const app=createApp({library,providerService:service});
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(req.method==='POST'&&url.pathname==='/qa/mode') {const next=url.searchParams.get('mode');if(['complete','fail','stall'].includes(next))mode=next;res.end(JSON.stringify({mode}));return;}
 app(req,res);
}).listen(0,'127.0.0.1',()=>console.log('CONTROLLED_QA_PORT',server.address().port));
process.on('SIGINT',()=>{server.close(async()=>{await rm(dir,{recursive:true,force:true});process.exit(0);});});
