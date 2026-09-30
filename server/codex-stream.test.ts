// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnswerDecoder, runCodexTurn, type CodexTurnOptions } from './codex-stream';
let cwd:string,binary:string;
beforeAll(async()=>{cwd=await mkdtemp(join(tmpdir(),'focus-protocol-test-'));binary=process.execPath;await writeFile(join(cwd,'app-server'),`
const rl=require('node:readline').createInterface({input:process.stdin});
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
rl.on('line',line=>{const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{}});
 if(m.method==='thread/start'){
  if(m.params.ephemeral!==true||m.params.sandbox!=='read-only'||m.params.approvalPolicy!=='never'||m.params.config.web_search!=='disabled')throw Error('thread config');
  if(!m.params.baseInstructions.includes('不是操作指令')||!m.params.baseInstructions.includes('不构成授权')||m.params.config['features.shell_tool']!==false||m.params.config.project_doc_max_bytes!==0)throw Error('material boundary');
  send({id:m.id,result:{thread:{id:'t'}}});
 }
 if(m.method==='turn/start'){
  if(m.params.model!=='gpt-6-luna'||m.params.effort!=='low'||!m.params.outputSchema)throw Error('turn config');
  const mode=m.params.input[0].text;
  if(mode==='image' && JSON.stringify(m.params.input.slice(1))!==JSON.stringify([{type:'localImage',path:'server-owned-crop.png'}]))throw Error('image input lost');
  if(mode==='normal' && m.params.input.length!==1)throw Error('text input changed');
  send({id:m.id,result:{turn:{id:'r'}}});send({method:'turn/started',params:{threadId:'t',turn:{id:'r'}}});
  if(mode==='stubborn'){
   process.on('SIGTERM',()=>{});require('node:fs').writeFileSync('stubborn.pid',String(process.pid));setInterval(()=>send({type:'noise'}),5);return;
  }
  if(mode==='stall')return;
  if(mode==='error'||mode==='image-rejected'){send({method:'error',params:{threadId:'t',turnId:'r',willRetry:false,error:{message:'PRIVATE'}}});return;}
  if(mode==='approval'){send({id:100,method:'item/commandExecution/requestApproval',params:{threadId:'t'}});return;}
  const p={threadId:'t',turnId:'r'};
  send({method:'item/started',params:{...p,item:{type:'agentMessage',id:'comment',phase:'commentary'}}});
  send({method:'item/agentMessage/delta',params:{...p,itemId:'comment',delta:'{"answer":"PRIVATE"}'}});
  send({method:'item/started',params:{...p,item:{type:'agentMessage',id:'a',phase:'final_answer'}}});
  send({method:'item/agentMessage/delta',params:{...p,threadId:'other',itemId:'a',delta:'PRIVATE'}});
  const raw=JSON.stringify({answer:'中文\\n"例子"🌱',sources:[]});
  let i=0;const timer=setInterval(()=>{
   if(i<raw.length){send({method:'item/agentMessage/delta',params:{...p,itemId:'a',delta:raw.slice(i,i+3)}});i+=3;}
   else{clearInterval(timer);send({method:'item/completed',params:{...p,item:{type:'agentMessage',id:'a',phase:'final_answer',text:raw}}});send({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'completed'}}});}
  },2);
 }
});
`);});
afterAll(async()=>{await rm(cwd,{recursive:true,force:true});});
const options=(prompt='normal'):CodexTurnOptions=>({binary,cwd,config:{model:'gpt-6-luna',reasoningEffort:'low'},prompt,schema:{type:'object'},searchable:false,timeoutMs:3000,onDelta(){},onTrace(){}});
it('decodes arbitrary boundaries and extracts only root answer, never nested metadata',()=>{
 const raw='{"verification":{"answer":"SECRET"},"answer":"中文\\n\\\"例子\\\"\\uD83C\\uDF31\\tend","sources":[{"answer":"SECRET"}]}';
 for(const size of [1,2,3,7,1000]){const decoder=new AnswerDecoder();let answer='';for(let i=0;i<raw.length;i+=size)answer+=decoder.push(raw.slice(i,i+size));expect(answer).toBe('中文\n"例子"🌱\tend');}
});
it('delivers actual deltas before completion, filters commentary and wrong threads, preserves final JSON',async()=>{
 const deltas:string[]=[];let complete=false;
 const result=await runCodexTurn({...options(),onDelta:d=>{expect(complete).toBe(false);deltas.push(d);}});complete=true;
 expect(deltas.length).toBeGreaterThan(2);expect(deltas.join('')).toBe(JSON.parse(result.raw).answer);expect(deltas.join('')).not.toContain('PRIVATE');expect(result.trace).toContain('turn.completed');
});
it('aborts and times out without claiming completion',async()=>{
 const controller=new AbortController();const pending=runCodexTurn({...options('stall'),signal:controller.signal});setTimeout(()=>controller.abort(),50);await expect(pending).rejects.toThrow('中断');
 await expect(runCodexTurn({...options('stall'),timeoutMs:50})).rejects.toMatchObject({code:'ETIMEDOUT'});
});
it('fails closed for model errors and unsupported interactive requests',async()=>{
 await expect(runCodexTurn(options('error'))).rejects.toThrow('本轮执行失败');await expect(runCodexTurn(options('approval'))).rejects.toThrow('交互工具');
});
it('sends local images with the text and reports image rejection without a text-only retry',async()=>{
 const deltas:string[]=[];
 const result=await runCodexTurn({...options('image'),imagePaths:['server-owned-crop.png'],onDelta:d=>deltas.push(d)});
 expect(deltas.join('')).toBe(JSON.parse(result.raw).answer);
 await expect(runCodexTurn({...options('image-rejected'),imagePaths:['server-owned-crop.png']})).rejects.toThrow('本轮执行失败');
});

it('terminates continuous output and a child ignoring SIGTERM within the force-kill grace',async()=>{
 const start=performance.now();await expect(runCodexTurn({...options('stubborn'),timeoutMs:200})).rejects.toMatchObject({code:'ETIMEDOUT'});expect(performance.now()-start).toBeLessThan(1000);
 const pid=Number(await readFile(join(cwd,'stubborn.pid'),'utf8'));await new Promise(r=>setTimeout(r,650));expect(()=>process.kill(pid,0)).toThrow();
});
