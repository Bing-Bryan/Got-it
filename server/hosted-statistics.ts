import {existsSync,readFileSync} from 'node:fs';
import {atomicJson,HostedError,utcDay} from './hosted-budget';
import {FEATURE_KEYS} from '../src/lib/hosted-feature-keys';
export {FEATURE_KEYS} from '../src/lib/hosted-feature-keys';
const counts=['0','1','2to5','6plus'];
const returns=['first','days1to3','days4to7','days8plus'];
const sources=['sample','markdown','pdf'];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
export interface DailySummary {date:string;returnBucket:string;sources:string[];features:Record<string,{count:string;onReturnDay:boolean}>;}
export function parseSummary(v:unknown,now=Date.now()):DailySummary {
  const invalid=()=>{throw new HostedError('统计摘要格式无效');};
  if(!object(v)||!exact(v,['date','returnBucket','sources','features']))return invalid();
  if(typeof v.date!=='string'||![utcDay(now),utcDay(now-86400000)].includes(v.date)||!returns.includes(String(v.returnBucket)))return invalid();
  if(!Array.isArray(v.sources)||v.sources.length>3||new Set(v.sources).size!==v.sources.length||v.sources.some(s=>!sources.includes(s)))return invalid();
  if(!object(v.features)||!exact(v.features,FEATURE_KEYS))return invalid();
  for(const entry of Object.values(v.features))if(!object(entry)||!exact(entry,['count','onReturnDay'])||!counts.includes(String(entry.count))||typeof entry.onReturnDay!=='boolean'||(entry.onReturnDay&&(entry.count==='0'||v.returnBucket==='first')))return invalid();
  return v as unknown as DailySummary;
}
// Keys and aggregate counters only; no input object is ever serialized.
type Aggregates={version:1;days:Record<string,Record<string,number>>};
export class HostedStatistics {
  private state:Aggregates={version:1,days:{}};
  private day='';private ids=new Set<string>();private ips=new Map<string,number>();
  constructor(private path:string,private now=Date.now){
    if(existsSync(path)){const v=JSON.parse(readFileSync(path,'utf8')) as Aggregates;
      if(v.version!==1||!object(v.days)||Object.values(v.days).some(day=>!object(day)||Object.values(day).some(n=>!Number.isSafeInteger(n)||n<0)))throw new Error('Invalid hosted statistics aggregate');this.state=v;}
  }
  record(input:unknown,id:string,ip:string){
    const now=this.now(),day=utcDay(now),summary=parseSummary(input,now);
    if(this.day!==day){this.ids.clear();this.ips.clear();this.day=day;}
    const key=`${summary.date}:${id}`;
    if(this.ids.has(key))return;
    if((this.ips.get(ip)||0)>=60)throw new HostedError('统计上报已达上限',429);
    const aggregate={...(this.state.days[summary.date]||{})};
    const add=(key:string)=>{aggregate[key]=(aggregate[key]||0)+1;};
    add('summaries');add(`return:${summary.returnBucket}`);
    for(const source of summary.sources)add(`source:${source}`);
    for(const feature of FEATURE_KEYS){const entry=summary.features[feature];add(`feature:${feature}:count:${entry.count}`);if(entry.onReturnDay)add(`feature:${feature}:return`);
      for(const source of summary.sources)if(entry.count!=='0')add(`source:${source}:feature:${feature}:reach`);
    }
    const next={version:1 as const,days:{...this.state.days,[summary.date]:aggregate}};
    try{atomicJson(this.path,next);}catch{throw new HostedError('统计暂不可用',503);}
    this.state=next;this.ids.add(key);this.ips.set(ip,(this.ips.get(ip)||0)+1);
  }
}
