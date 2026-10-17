// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {HostedBudget,initializeBudget} from './hosted-budget';
import {HostedTranslations,hostedTranslationPrompt,parseHostedTranslation,type HostedTranslationModel} from './hosted-translations';
import {TRANSLATION_QUALITY_VERSION} from '../src/lib/web-translation';
const token='c'.repeat(64),dirs:string[]=[],budgets:HostedBudget[]=[];
afterEach(()=>{for(const b of budgets.splice(0))b.close();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
function setup(limit=3,model?:HostedTranslationModel,timeoutMs=60000){const dir=mkdtempSync(join(tmpdir(),'hosted-translation-'));dirs.push(dir);const path=join(dir,'budget.json');initializeBudget(path);const budget=new HostedBudget(path,limit);budgets.push(budget);const runner=model??(async()=>({data:{translations:{unit:'这是一段中文译文。'}},usage:{prompt_tokens:100,completion_tokens:30}}));return {path,budget,jobs:new HostedTranslations(budget,runner,Date.now,timeoutMs)};}
const input=(operationId='operation')=>({qualityVersion:TRANSLATION_QUALITY_VERSION,operationId,roundId:'round',translationId:'translation',sourceVersion:'f'.repeat(64),units:[{id:'unit',blockId:'block',text:'A useful phrase.'}]});
describe('hosted stateless translation and cost protection',()=>{
 it('returns truthful provider metadata, validates units, reserves the complete serialized prompt and never persists text',async()=>{
  const model=vi.fn<HostedTranslationModel>(async(prompt)=>{expect(prompt).toContain('不能将含义挪入其他块');expect(prompt).toContain('structure');return {data:{translations:{unit:'有用的短语。'}},usage:{prompt_tokens:100,completion_tokens:30}};});
  const {jobs,path,budget}=setup(3,model);const result=await jobs.batch('owner','ip',token,input(),new AbortController().signal);expect(result).toMatchObject({providerId:'deepseek',modelConfig:{model:'deepseek-flash',reasoningEffort:'none'},units:{unit:'有用的短语。'}});expect(model).toHaveBeenCalledTimes(1);const disk=readFileSync(path,'utf8');expect(disk).not.toContain('有用');expect(disk).not.toContain('owner');
  const replay=await jobs.batch('owner','ip',token,input(),new AbortController().signal);expect(replay.units).toEqual(result.units);expect(replay.repairCount).toBe(0);expect(await jobs.batch('owner','ip','e'.repeat(64),{...input(),roundId:'after-reload'},new AbortController().signal)).toMatchObject({units:{unit:'有用的短语。'}});expect(model).toHaveBeenCalledTimes(1);expect(budget.status('owner','ip').remaining).toBe(29);
  await expect(jobs.batch('owner','ip',token,{...input(),units:[{id:'unit',blockId:'block',text:'A different phrase.'}]},new AbortController().signal)).rejects.toMatchObject({code:'translation_completed'});expect(model).toHaveBeenCalledTimes(1);
 });
 it('repairs only failed placeholders once with a separate reservation, preserves good units and rejects persistent corruption',async()=>{
  const request={...input(),units:[{id:'unit',blockId:'block',text:'A [GOTIT_OPEN_1]useful[GOTIT_CLOSE_2] phrase.'},{id:'good',blockId:'block',text:'Another phrase.'}]};let calls=0;
  const model:HostedTranslationModel=async(prompt)=>{calls++;return {data:{translations:calls===1?{unit:'一个[GOTIT_OPEN_1]有用短语。',good:'另一个短语。'}:{unit:'一个[GOTIT_OPEN_1]有用[GOTIT_CLOSE_2]短语。'}},usage:{prompt_tokens:100,completion_tokens:30}};};
  const {jobs,budget}=setup(3,model);const result=await jobs.batch('owner','ip',token,request,new AbortController().signal);expect(result.repairCount).toBe(1);expect(result.units.good).toBe('另一个短语。');expect(calls).toBe(2);expect(budget.status('owner','ip').remaining).toBe(28);
  let badCalls=0;const bad=setup(3,async()=>{badCalls++;return {data:{translations:{unit:'有用短语。',good:'另一个短语。'}},usage:{prompt_tokens:100,completion_tokens:30}};});await expect(bad.jobs.batch('owner','ip',token,request,new AbortController().signal)).rejects.toMatchObject({code:'translation_invalid'});expect(badCalls).toBe(2);
 });
 it('refuses unaffordable full-prompt reservation before calling the model and enforces request field/unit caps',async()=>{
  const model=vi.fn<HostedTranslationModel>();const {jobs}=setup(.001,model);await expect(jobs.batch('owner','ip',token,input(),new AbortController().signal)).rejects.toMatchObject({code:'global_quota_exhausted'});expect(model).not.toHaveBeenCalled();
  for(const request of [{...input(),providerId:'codex'},{...input(),units:[{...input().units[0],url:'https://example.org'}]},{...input(),units:Array(65).fill(input().units[0])},{...input(),units:[{...input().units[0],text:'x'.repeat(4001)}]}])expect(()=>parseHostedTranslation(request)).toThrow();
  expect(Buffer.byteLength(hostedTranslationPrompt(input().units))+128).toBeGreaterThan(input().units[0].text.length);
 });
 it('deduplicates active calls, binds tokens, cancels before/after start and ignores late results with conservative cost',async()=>{
  let finish!:(v:Awaited<ReturnType<HostedTranslationModel>>)=>void;const model=vi.fn<HostedTranslationModel>(async()=>new Promise(r=>finish=r));const {jobs,path}=setup(3,model);
  const first=jobs.batch('owner','ip',token,input(),new AbortController().signal);const dup=jobs.batch('owner','ip',token,input(),new AbortController().signal);
  await expect(jobs.batch('owner','ip','d'.repeat(64),input(),new AbortController().signal)).rejects.toMatchObject({status:403});jobs.cancel('owner','operation',token);await expect(first).rejects.toMatchObject({code:'translation_cancelled'});await expect(dup).rejects.toMatchObject({code:'translation_cancelled'});expect(model).toHaveBeenCalledTimes(1);finish({data:{translations:{unit:'迟到的译文。'}},usage:{prompt_tokens:100,completion_tokens:30}});
  expect(Object.values(JSON.parse(readFileSync(path,'utf8')).days as Record<string,{charged:number}>)[0].charged).toBeGreaterThan(.0096);
  jobs.cancel('owner','before-start',token);await expect(jobs.batch('owner','ip',token,input('before-start'),new AbortController().signal)).rejects.toMatchObject({code:'translation_cancelled'});expect(model).toHaveBeenCalledTimes(1);
 });
 it('times out the complete main-and-repair batch and does not return a partial success',async()=>{
  const {jobs}=setup(3,async()=>new Promise(()=>{}),10);await expect(jobs.batch('owner','ip',token,input(),new AbortController().signal)).rejects.toMatchObject({status:408});
 });
});
