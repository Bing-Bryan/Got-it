import { PdfOutlineStore } from '../server/pdf-outline.ts';
// Local, explicitly controlled UI fixture. Never used by the application.
import {PNG} from 'pngjs';
import {pdfFixture} from '../server/test-support/pdf-fixture.ts';
import { stableHash } from '../src/sample.ts';
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
const fixturePort=Number(process.argv.find(arg=>arg.startsWith('--port='))?.slice(7)??5176);
if(!Number.isInteger(fixturePort)||fixturePort<1024||fixturePort>65535)throw new Error('Invalid fixture port');
let mode='complete';
const dir=await mkdtemp(join(tmpdir(),'got-it-reading-detail-'));const library=new ReadingLibrary(dir);
const w=readingFixture('阅读详情受控验收.md');
const paragraphs=Array.from({length:32},(_,i)=>`阅读概念 ${i+1}：读懂文章需要把当前解释与原文放在一起，再按自己的节奏继续。`);
w.document.markdown='# 阅读详情受控验收\n\n'+paragraphs.join('\n\n');
w.inquiries=paragraphs.map((text,i)=>({...structuredClone(w.inquiries[0]),id:`qa-${i}`,question:`解释阅读概念 ${i+1}`,anchor:{...w.inquiries[0].anchor,blockId:`block-${i+1}-${stableHash('p:'+text).slice(0,7)}`,quote:`阅读概念 ${i+1}`,start:0,end:`阅读概念 ${i+1}`.length,suffix:text.slice(`阅读概念 ${i+1}`.length)},messages:[{id:`old-${i}`,role:'assistant',content:'历史受控回答：保留当时的解释。',createdAt:'2026-10-07',completion:'complete',mode:'live'},{id:`answer-${i}`,role:'assistant',content:'此回答为界面验收的受控内容，未调用真实模型。\n\n## 理解这段原文\n\n把原文与补充解释放在一起，可以减少来回寻找上下文的负担。\n\n'+Array.from({length:8},(_,j)=>`### 阅读要点 ${j+1}\n\n先看当前解释，再结合左侧原文判断它是否解决了疑问。用户可以直接返回列表或继续阅读。`).join('\n\n'),createdAt:'2026-10-08',completion:'complete',mode:'live',operation:'explain'}],updatedAt:`2026-10-08T00:00:${String(59-i).padStart(2,'0')}Z`}));
const base=structuredClone(w.inquiries[0]);
w.inquiries.push({...structuredClone(base),id:'qa-duplicate',updatedAt:'2026-10-01',status:'distilled',understanding:'旧理解记录',completedAt:'2026-10-01',messages:[{...base.messages[0],id:'duplicate-answer',content:'受控重复线程，保留旧理解记录。'}]});
w.inquiries.push({...structuredClone(base),id:'qa-why',intent:'why',messages:[{...base.messages[0],id:'why-answer',content:'受控历史 why 回答。'}]});
w.inquiries.push({...structuredClone(base),id:'qa-entity',intent:'entity',messages:[{...base.messages[1],id:'entity-answer',operation:'entity',content:'受控机构介绍。\n\n| 项目 | 说明 |\n| --- | --- |\n| 官网 | https://example.org/abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz |',sources:[{id:'site',title:'受控官网',url:'https://example.org',domain:'example.org',websiteRole:'official'}]}]});
w.inquiries.push({...structuredClone(base),id:'qa-verify',intent:'verify',lastError:'受控搜索失败：未得到可用结果。',messages:[{...base.messages[0],id:'verify-answer',operation:'verify',completion:'interrupted',search:{status:'failed',completedSearches:0,failedSearches:1},verification:{verdict:'incomplete',completion:'interrupted',summary:'查找未完成',reason:'受控失败',readingAdvice:'保留限制',claims:[],round:1,scope:'initial'}}]});
w.inquiries.push({...structuredClone(base),id:'qa-missing',anchor:{...base.anchor,quote:'不可恢复的旧选区',end:8,blockId:'missing',matchStatus:'needs-relink'},messages:[{...base.messages[0],id:'missing-answer',content:'受控失效锚点的既有回答仍保留。'}]});
w.activeInquiryId='qa-0';w.activeProviderId='codex';
if(process.argv.includes('--compact-answers')) {
 const item=w.inquiries[0];item.intent='ask';item.question='有哪些可参考的产品？';
 item.messages=[{id:'compact-answer',role:'assistant',createdAt:'2026-10-09',completion:'complete',mode:'live',operation:'ask',explanationMode:'auto',content:'以下为合成界面样本，未调用模型。\n\n- [示例产品 A](https://example.org/a)：适合快速搭建应用。\n- [示例产品 B](https://example.org/b)：支持编辑与发布。\n- [示例产品 C](https://example.org/c)：适合尝试不同创意。',search:{status:'unknown',completedSearches:0,failedSearches:0},sources:[{id:'a',title:'示例产品 A',url:'https://example.org/a',domain:'example.org',retrievalStatus:'unavailable'},{id:'b',title:'示例产品 B',url:'https://example.org/b',domain:'example.org',retrievalStatus:'matched'},{id:'r',title:'补充说明',url:'https://example.org/reference',domain:'example.org',retrievalStatus:'not-read'}]}];
}
if(process.argv.includes('--code-block')) {
 w.document.markdown='# 代码块阅读样式验收\n\n这是一段常规正文，用于对照代码块字号与阅读体验。\n\n```text\n+--------------------------------------------------------------+\n| 需求层级       | 支持能力                                     |\n+--------------------------------------------------------------+\n| 协作与分享     | 分享作品、邀请伙伴、收集反馈                   |\n| 快速开始       | 清晰的操作入口、完整的帮助说明                 |\n+--------------------------------------------------------------+\n```\n\n正文与代码块使用相同字号，保留等宽字体以维持文字表格的排列。';
 w.inquiries=[];w.activeInquiryId=null;
}
if(process.argv.includes('--verification-footer')) {
 const item=structuredClone(w.inquiries.find(i=>i.id==='qa-verify'));
 item.id='qa-verify-complete';delete item.lastError;
 item.messages=[{...item.messages[0],id:'older-verification',content:'受控历史查证，不展示旧回答入口。'},
 {...item.messages[0],id:'complete-verification',content:'受控来源结果，未调用真实模型。',completion:'complete',search:{status:'executed',completedSearches:1,failedSearches:0},verification:{verdict:'supported',completion:'complete',summary:'找到了相关来源',reason:'受控界面样本',readingAdvice:'',claims:[],round:2,scope:'expanded'},sources:[{id:'qa-source',title:'受控阅读资料',url:'https://example.org',domain:'example.org',publisher:'示例来源',retrievalStatus:'matched'}]}];
 w.inquiries.push(item);w.activeInquiryId=item.id;
}
const e=await library.add(w,'controlled');await library.activate(e.id);
const pdfSelection=await library.uploadPdf('阅读详情合成图表.pdf',pdfFixture(8));
let pdfEntry=await library.add(pdfSelection.workspace,'pdf-controlled',pdfSelection.selectionId);
const pw=pdfEntry.workspace,h=pw.document.contentHash;
const rect=[70,60,300,200];
const crop=await library.resources.crop(pdfEntry.id,h,1,rect,PNG.sync.write(new PNG({width:20,height:20,fill:true})));
const ocr=await library.resources.ocr(pdfEntry.id,{version:1,fileHash:h,page:1,lines:[{text:'Alpha 1O',rect:[70,210,300,230],block:'r'}]});
pw.inquiries=[1,8].map(page=>({...structuredClone(base),id:`pdf-${page}`,anchor:{documentId:pw.document.id,blockId:`pdf-${page}`,headingPath:[],quote:page===1?'第 1 页 · 所选区域':'SYNTHETIC CHART 8',prefix:'',suffix:'',start:0,end:page===1?0:17,matchStatus:'matched',pdf:page===1?{kind:'region',source:'image',fileHash:h,page,rects:[rect],cropId:crop.id,ocrId:ocr.id,originalText:'Alpha 1O',context:'Alpha 10'}:{kind:'text',source:'native',fileHash:h,page,rects:[[70,240,270,265]],context:'SYNTHETIC CHART 8'}},status:'understood',completedAt:'2026-10-01',understanding:'旧理解记录'}));
pw.activeInquiryId='pdf-1';pdfEntry=await library.save(pdfEntry.id,pdfEntry.version,pdfEntry.revisionId,pw,{});
await library.activate(e.id);
if(process.argv.includes('--reading-time')) {
 const outlines=new PdfOutlineStore(library);
 const text='BT /F1 12 Tf 30 265 Td '+Array.from({length:12},(_,i)=>(i?'0 -18 Td ':'')+'(Reading time example with native text and no model request.) Tj').join(' ')+' ET';
 for(const [name,content] of [['原生文字阅读时间.pdf',text],['无文字层阅读时间.pdf','0.3 0.25 0.8 rg 70 60 150 120 re f']]) {
  const uploaded=await library.uploadPdf(name,pdfFixture(2,0,false,false,content));
  const entry=await library.add(uploaded.workspace,`reading-time-${content.length}`,uploaded.selectionId);
  const hash=entry.workspace.document.pdf.resourceId;
  await outlines.save(entry.id,hash,{version:1,fileHash:hash,revision:0,reviewed:true,items:[{id:'qa-native',title:'受控样本',page:1,top:0,level:1,source:'manual'}]});
 }
 await library.activate(e.id);
}
const service=new ProviderService({modelCatalog:testModelCatalog,codexTimeoutMs:15000,execFileImpl:async()=>({stdout:'Logged in',stderr:''}),codexTurnImpl:async o=>{
 if(mode==='fail')throw new Error('Controlled failure');
 o.onDelta('受控验收：已收到的部分正文。');
 if(mode==='stall')await new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));
 const raw=JSON.stringify({answer:'受控验收：补充回答已完成。',sources:[{id:'s',title:'受控公开样例',url:'https://example.org/definition',snippet:'This is a controlled quotation for UI testing.'}],verification:null,evidenceStatus:'not-applicable'});
 const trace=[{type:'turn.started'},{type:'item.completed',item:{id:'s',type:'web_search',action:{type:'search',query:'controlled'},status:'completed'}},{type:'turn.completed'}].map(JSON.stringify).join('\n');return {raw,trace};
},sourceReader:async url=>({url,text:'This is a controlled quotation for UI testing.'})});
const app=createApp({library,providerService:service});
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(req.method==='POST'&&url.pathname==='/api/qa/mode') {const next=url.searchParams.get('mode');if(['complete','fail','stall'].includes(next))mode=next;res.end(JSON.stringify({mode}));return;}
 app(req,res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {createServer:createVite}=await import('vite');
const web=await createVite({server:{port:fixturePort,open:false,proxy:{'/api':{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:false}}}});await web.listen();
console.log(`READING_DETAIL_QA http://localhost:${fixturePort}`);
process.on('SIGINT',()=>{server.close(async()=>{await rm(dir,{recursive:true,force:true});process.exit(0);});});
