import {HostedError} from './hosted-budget';
import {safeSourceUrl} from '../src/lib/evidence';
export const BOCHA_ORIGINS=['https://api.bocha.cn','https://api.bochaai.com'] as const;
export const SEARCH_LIMITS={queries:1,queryCharacters:256,results:5,timeoutMs:8000,responseBytes:512*1024,summaryBytes:1200,titleCharacters:200};
export interface SearchCandidate {id:string;title:string;url:string;summary:string;publishedAt?:string;}
export type HostedSearch=(query:string,signal:AbortSignal)=>Promise<SearchCandidate[]>;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function truncateBytes(text:string,bytes:number){let out='';for(const c of text){if(Buffer.byteLength(out+c,'utf8')>bytes)break;out+=c;}return out;}
export function parseBochaResponse(raw:unknown):SearchCandidate[]{
 if(!record(raw))throw new HostedError('搜索响应格式错误',502,'search_failed');
 if('code'in raw&&raw.code!==200)throw new HostedError('搜索服务返回失败',502,'search_failed');
 const data='data'in raw?raw.data:raw;
 if(!record(data)||!record(data.webPages)||!Array.isArray(data.webPages.value))throw new HostedError('搜索响应格式错误',502,'search_failed');
 if(data.webPages.value.length>50)throw new HostedError('搜索响应超出限制',502,'search_failed');
 const seen=new Set<string>(),out:SearchCandidate[]=[];
 for(const item of data.webPages.value){
  if(!record(item)||typeof item.url!=='string'||item.url.length>8192||!safeSourceUrl(item.url))continue;
  const url=new URL(item.url);if(url.username||url.password||(url.port&&!['80','443'].includes(url.port)))continue;
  url.hash='';if(seen.has(url.href))continue;seen.add(url.href);
  const summary=typeof item.summary==='string'&&item.summary.trim()?item.summary:typeof item.snippet==='string'?item.snippet:'';
  out.push({id:`source-${out.length+1}`,title:typeof item.name==='string'?item.name.slice(0,SEARCH_LIMITS.titleCharacters):url.hostname,url:url.href,summary:truncateBytes(summary,SEARCH_LIMITS.summaryBytes),...(typeof item.datePublished==='string'&&/^\d{4}-\d{2}-\d{2}(?:T[\d:+.Z-]+)?$/.test(item.datePublished)&&item.datePublished.length<40?{publishedAt:item.datePublished}:{})});
  if(out.length===SEARCH_LIMITS.results)break;
 }
 return out;
}
export function createBochaSearch(apiKey:string,origin:string='https://api.bocha.cn',fetcher:typeof fetch=fetch):HostedSearch{
 if(!BOCHA_ORIGINS.includes(origin as typeof BOCHA_ORIGINS[number]))throw new Error('Unsupported Bocha API origin');
 return async(query,parent)=>{
  if(!query.trim()||[...query].length>SEARCH_LIMITS.queryCharacters)throw new HostedError('搜索查询超过限制',400,'query_limit');
  const signal=AbortSignal.any([parent,AbortSignal.timeout(SEARCH_LIMITS.timeoutMs)]);
  try{
   signal.throwIfAborted();
   const response=await fetcher(`${origin}/v1/web-search`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({query,freshness:'noLimit',summary:true,count:SEARCH_LIMITS.results}),redirect:'error',signal});
   if(!response.ok||!response.body)throw new HostedError('搜索服务失败，请重试',502,'search_failed');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
   try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>SEARCH_LIMITS.responseBytes)throw new HostedError('搜索响应超过限制',502,'search_failed');chunks.push(part.value);}}
   finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();}
   signal.throwIfAborted();
   return parseBochaResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }catch(error){if(parent.aborted)throw parent.reason;if(error instanceof HostedError)throw error;throw new HostedError('搜索服务失败或超时，请重试',502,'search_failed');}
 };
}
