import {dirname} from 'node:path';
import { syncDirectory } from './private-storage';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export const MAX_INPUT_TOKENS = 8000;
export const MAX_OUTPUT_TOKENS = 1500;
// Highest published tariff, cache misses; reserve before sending any model request.
export const MAX_REQUEST_USD = (MAX_INPUT_TOKENS * .30 + MAX_OUTPUT_TOKENS * 1.20) / 1_000_000;
export type BudgetState = {version:1; days: Record<string, {charged:number;blocked?:boolean}>};
export class HostedError extends Error { constructor(message:string, public status=400, public code='invalid_request') {super(message);} }
export const utcDay = (now=Date.now()) => new Date(now).toISOString().slice(0,10);
export function atomicJson(path:string, data:unknown) {
  const temp = `${path}.tmp`;
  const fd=openSync(temp,'w',0o600);
  try {writeFileSync(fd,JSON.stringify(data));fsyncSync(fd);} finally {closeSync(fd);}
  renameSync(temp,path);
  syncDirectory(dirname(path));
}
export function initializeBudget(path:string) {
  const fd=openSync(path,'wx',0o600);
  try {writeFileSync(fd,JSON.stringify({version:1,days:{}}));fsyncSync(fd);} finally {closeSync(fd);}
}
function processAlive(pid:number){try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code==='EPERM';}}
// The lock records its owner's PID: a lock left by a killed or crashed process is
// taken over, while a live owner (including this process) still blocks a second writer.
function acquireLock(path:string){
  for(let attempt=0;attempt<2;attempt++){
    try{const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,String(process.pid));fsyncSync(fd);}finally{closeSync(fd);}return;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const owner=readFileSync(path,'utf8').trim();
    if(!/^\d+$/.test(owner))throw new Error(`Hosted budget lock ${path} has no owner PID (left by an older version); confirm no hosted API process is running, then remove it`);
    if(Number(owner)!==process.pid&&!processAlive(Number(owner))){unlinkSync(path);continue;}
    throw new Error(`Hosted budget is locked by running process ${owner}`);
  }
  throw new Error('Hosted budget lock could not be acquired');
}
export class HostedBudget {
  private state:BudgetState;
  private failed=false;
  private lock:string;
  private identities=new Map<string,number>();
  private ips=new Map<string,number>();
  private memoryDay='';
  constructor(public path:string, private limit=3, private now=Date.now) {
    if(!Number.isFinite(limit)||limit<=0||limit>3) throw new Error('Invalid hosted daily limit');
    this.lock=`${path}.lock`;
    acquireLock(this.lock);
    try {
      const value=JSON.parse(readFileSync(path,'utf8')) as BudgetState;
      if(value.version!==1||!value.days||typeof value.days!=='object'||Array.isArray(value.days)||Object.entries(value.days).some(([day,v])=>!/^\d{4}-\d{2}-\d{2}$/.test(day)||!v||!Number.isFinite(v.charged)||v.charged<0||(v.blocked!==undefined&&typeof v.blocked!=='boolean'))) throw new Error('Invalid hosted budget ledger');
      this.state=value;
    } catch {unlinkSync(this.lock);throw new Error('Hosted budget missing or unreadable; initialization/recovery required');}
  }
  close(){if(existsSync(this.lock)&&readFileSync(this.lock,'utf8').trim()===String(process.pid))unlinkSync(this.lock);}
  private day(){const day=utcDay(this.now());if(this.memoryDay!==day){this.identities.clear();this.ips.clear();this.memoryDay=day;}return day;}
  status(id:string,ip:string){const day=this.day();return {remaining:Math.max(0,Math.min(30-(this.identities.get(id)||0),60-(this.ips.get(ip)||0))),browserLimit:30,ipLimit:60,resetAt:new Date(`${day}T00:00:00Z`).getTime()+86400000,globalExhausted:this.failed||this.state.days[day]?.blocked===true||(this.state.days[day]?.charged||0)+MAX_REQUEST_USD>this.limit};}
  reserve(id:string,ip:string,searchCostUsd=0,limits={input:MAX_INPUT_TOKENS,output:MAX_OUTPUT_TOKENS}){
    if(!Number.isSafeInteger(limits.input)||!Number.isSafeInteger(limits.output)||limits.input<1||limits.input>48000||limits.output<1||limits.output>8000)throw new HostedError('模型预算参数无效');
    const modelReservation=(limits.input*.30+limits.output*1.20)/1_000_000;
    if(!Number.isFinite(searchCostUsd)||searchCostUsd<0||searchCostUsd>this.limit)throw new HostedError('搜索费用未确认，查证暂不可用',503,'search_price_unavailable');
    const reservation=modelReservation+searchCostUsd;
    const status=this.status(id,ip);
    if(this.failed||this.state.days[this.day()]?.blocked===true||(this.state.days[this.day()]?.charged||0)+reservation>this.limit)throw new HostedError('今日体验额度已用完',429,'global_quota_exhausted');
    if(status.remaining<=0)throw new HostedError('今日体验次数已用完',429,'quota_exhausted');
    const day=this.day();
    this.state.days[day]??={charged:0};this.state.days[day].charged+=reservation;
    this.persist();
    this.identities.set(id,(this.identities.get(id)||0)+1);this.ips.set(ip,(this.ips.get(ip)||0)+1);
    let settled=false;
    return (usage?:{prompt_tokens:number;completion_tokens:number})=>{
      if(settled)return;settled=true;
      // Missing usage (failure/cancellation/crash) retains the complete reservation.
      if(!usage)return;
      const {prompt_tokens:input,completion_tokens:output}=usage;
      if(!Number.isSafeInteger(input)||!Number.isSafeInteger(output)||input<0||output<0||input>limits.input||output>limits.output){this.failed=true;this.state.days[day].blocked=true;this.persist();throw new HostedError('模型用量异常，体验服务已暂停',503,'usage_invalid');}
      this.state.days[day].charged=Math.max(0,this.state.days[day].charged-modelReservation+(input*.30+output*1.20)/1_000_000);
      this.persist();
    };
  }
  private persist(){try{atomicJson(this.path,this.state);}catch{this.failed=true;throw new HostedError('额度存储不可用，体验服务已暂停',503,'budget_unavailable');}}
}
