import { HOSTED, trialId } from './runtime-mode';
import {FEATURE_KEYS} from './hosted-feature-keys';
export {FEATURE_KEYS} from './hosted-feature-keys';
export type FeatureKey=typeof FEATURE_KEYS[number];
export type UsageSummary={date:string;returnBucket:'first'|'days1to3'|'days4to7'|'days8plus';sources:Array<'sample'|'markdown'|'pdf'>;features:Record<FeatureKey,{count:'0'|'1'|'2to5'|'6plus';onReturnDay:boolean}>};
type Day={counts:Partial<Record<FeatureKey,number>>;sources:UsageSummary['sources'];sent?:boolean};
type Store={enabled:boolean;first:string;firstFeatures:Partial<Record<FeatureKey,string>>;days:Record<string,Day>};
const KEY='got-it.usage.v1',today=()=>new Date().toISOString().slice(0,10);
function read():Store{try{const v=JSON.parse(localStorage.getItem(KEY)??'null');if(v&&typeof v.enabled==='boolean'&&v.days)return v;}catch{}return {enabled:true,first:today(),firstFeatures:{},days:{}};}
function write(s:Store){try{localStorage.setItem(KEY,JSON.stringify(s));}catch{/* Statistics never block reading. */}}
export function usageEnabled(){return read().enabled;}
export function setUsageEnabled(enabled:boolean){const s=read();s.enabled=enabled;if(!enabled)s.days={};write(s);}
export function markMaterial(source:'sample'|'markdown'|'pdf'){if(!HOSTED)return;const s=read();if(!s.enabled)return;const d=s.days[today()]??={counts:{},sources:[]};if(!d.sources.includes(source))d.sources.push(source);write(s);}
export function track(key:FeatureKey,source?:'sample'|'markdown'|'pdf'){if(!HOSTED||!FEATURE_KEYS.includes(key))return;const s=read();if(!s.enabled)return;const date=today(),d=s.days[date]??={counts:{},sources:[]};d.counts[key]=(d.counts[key]??0)+1;s.firstFeatures[key]??=date;if(source&&!d.sources.includes(source))d.sources.push(source);write(s);}
export function summaryFor(date:string,s:Store):UsageSummary{const d=s.days[date],age=Math.floor((Date.parse(date)-Date.parse(s.first))/86400000),returnBucket=age<=0?'first':age<=3?'days1to3':age<=7?'days4to7':'days8plus';return {date,returnBucket,sources:['sample','markdown','pdf'].filter(x=>d.sources.includes(x as any)) as UsageSummary['sources'],features:Object.fromEntries(FEATURE_KEYS.map(key=>{const n=d.counts[key]??0;return [key,{count:n===0?'0':n===1?'1':n<=5?'2to5':'6plus',onReturnDay:age>0&&n>0}];})) as UsageSummary['features']};}
export function flushUsage(beacon=false){if(!HOSTED)return;const s=read();if(!s.enabled)return;for(const [date,day]of Object.entries(s.days)){if(day.sent||(!beacon&&date===today()))continue;const payload=JSON.stringify(summaryFor(date,s));day.sent=true;write(s); // At most once: failure is deliberately dropped.
 if(beacon){try{navigator.sendBeacon('/api/hosted/usage',new Blob([JSON.stringify({experienceId:trialId(),summary:JSON.parse(payload)})],{type:'application/json'}));}catch{};continue;}
 void fetch('/api/hosted/usage',{method:'POST',headers:{'Content-Type':'application/json','X-Trial-Id':trialId()},body:payload,keepalive:true}).catch(()=>{});}}
export function installUsage(){if(!HOSTED)return()=>{};flushUsage();const close=()=>flushUsage(true);window.addEventListener('pagehide',close);return()=>window.removeEventListener('pagehide',close);}
