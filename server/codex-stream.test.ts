// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnswerDecoder, runCodexTurn, type CodexTurnOptions } from './codex-stream';
let cwd:string,binary:string;
beforeAll(async()=>{cwd=await mkdtemp(join(tmpdir(),'focus-protocol-test-'));binary=join(cwd,'fake.cjs');await writeFile(binary,`#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
rl.on('line',line=>{const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{}});
 if(m.method==='thread/start'){
  if(m.params.ephemeral!==true||m.params.sandbox!=='read-only'||m.params.approvalPolicy!=='never'||m.params.config.web_search!=='disabled')throw Error('thread config');
  send({id:m.id,result:{thread:{id:'t'}}});
 }
 if(m.method==='turn/start'){
  if(m.params.model!=='gpt-6-luna'||m.params.effort!=='low'||!m.params.outputSchema)throw Error('turn config');
  const mode=m.params.input[0].text;
  send({id:m.id,result:{turn:{id:'r'}}});send({method:'turn/started',params:{threadId:'t',turn:{id:'r'}}});
  if(mode==='stall')return;
  if(mode==='error'){send({method:'error',params:{threadId:'t',turnId:'r',willRetry:false,error:{message:'PRIVATE'}}});return;}
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
`);await chmod(binary,0o755);});
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
