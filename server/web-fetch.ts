import { localWebProxy,proxyPublicDns,proxyRequest,classifyWebTransport } from './web-proxy';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions, type IncomingMessage, type ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { publicAddress, type Resolver } from './source-reader';
import { safeWebUrl } from '../src/lib/web-data';
import { LibraryError } from './file-picker';
export const WEB_LIMITS = {htmlBytes:10*1024*1024,imageBytes:32*1024*1024,totalBytes:160*1024*1024,mediaBytes:128*1024*1024,mediaCount:100,requests:200,redirects:3,requestMs:15000,jobMs:90000,previewMs:15*60*1000,pixels:40000000,dimension:16384,svgBytes:1024*1024,svgElements:10000,svgDepth:64};
export class WebError extends LibraryError { constructor(message:string,code='web_invalid',status=400){super(message,status,code);} }
export function webUrl(input:unknown):URL {
 try {
  if(typeof input!=='string'||!safeWebUrl(input))throw new Error();
  const url=new URL(input);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port)throw new Error();
  for(const [key] of url.searchParams)if(/^(?:access[_-]?token|auth|authorization|api[_-]?key|token|secret|password|passwd|signature|sig|credential|key|x-amz-.+|x-goog-.+)$/i.test(key))throw new Error();
  url.hash='';return url;
 }catch{throw new WebError('请使用不含登录凭据的公开 HTTP(S) 链接。','web_url_invalid');}
}
export interface WebBudget {requests:number;bytes:number}
export interface FetchedWeb {url:string;bytes:Buffer;type:string}
export type WebTransport=(options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ClientRequest;
async function fetchWebOnce(input:string,options:{signal:AbortSignal;budget?:WebBudget;maxBytes?:number;resolver?:Resolver;transport?:WebTransport;validateUrl?:(url:string)=>unknown}):Promise<FetchedWeb>{
 let url=webUrl(input);const budget=options.budget??{requests:0,bytes:0};
 const proxy=!options.resolver&&!options.transport?localWebProxy():undefined;
 const signal=AbortSignal.any([options.signal,AbortSignal.timeout(WEB_LIMITS.requestMs)]);
 for(let hop=0;hop<=WEB_LIMITS.redirects;hop++){
  options.validateUrl?.(url.href);
  signal.throwIfAborted();
  if(++budget.requests>WEB_LIMITS.requests)throw new WebError('网页请求次数超过限制。','web_budget');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  const addresses=await abortable(isIP(host)?Promise.resolve([{address:host,family:isIP(host)}]):(options.resolver??(proxy?((h)=>proxyPublicDns(proxy,h,signal)):((h)=>lookup(h,{all:true}))))(host),signal);
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new WebError('链接或资源不是公共网络地址。','web_address');
  const address=addresses[0];
  const result=await new Promise<{location?:string;bytes?:Buffer;type?:string}>((resolve,reject)=>{
   const pinned:RequestOptions={protocol:url.protocol,hostname:address.address,family:address.family,port:url.protocol==='https:'?443:80,path:url.pathname+url.search,servername:isIP(host)?undefined:host,headers:{Host:url.host,Accept:'text/html,image/png,image/jpeg,image/webp,image/svg+xml,*/*;q=0.1','Accept-Encoding':'gzip, deflate, br','User-Agent':'Got-it/0.1 static-reader'},agent:false,signal,maxHeaderSize:16384} as RequestOptions;
   const request=(options.transport??(proxy?((o,c)=>proxyRequest(proxy,o,c)):(url.protocol==='https:'?httpsRequest:httpRequest)))(pinned,response=>{
    const status=response.statusCode??0;
    if([301,302,303,307,308].includes(status)&&response.headers.location){response.destroy();resolve({location:response.headers.location});return;}
    if(status!==200){response.destroy();reject(new WebError(status===401||status===403?'源站拒绝公开读取；可能需要登录或访问验证，不能绕过。':'网页或图片暂时无法读取。','web_unavailable',502));return;}
    const encoding=response.headers['content-encoding'];
    const decoded=!encoding||encoding==='identity'?response:encoding==='gzip'?response.pipe(createGunzip()):encoding==='deflate'?response.pipe(createInflate()):encoding==='br'?response.pipe(createBrotliDecompress()):null;
    if(!decoded){response.destroy();reject(new WebError('不支持该响应压缩格式。'));return;}
    let length=0;const chunks:Buffer[]=[];
    response.on('error',reject);decoded.on('error',reject);
    decoded.on('data',(chunk:Buffer)=>{
     length+=chunk.length;budget.bytes+=chunk.length;
     if(length>(options.maxBytes??WEB_LIMITS.imageBytes)||budget.bytes>WEB_LIMITS.totalBytes){const error=new WebError('网页或媒体超过读取容量限制。','web_budget');decoded.destroy(error);response.destroy(error);return;}
     chunks.push(chunk);
    });
    decoded.on('end',()=>resolve({bytes:Buffer.concat(chunks),type:String(response.headers['content-type']??'').toLowerCase()}));
   });request.on('error',reject);request.end();
  });
  if(result.location){if(hop===WEB_LIMITS.redirects)throw new WebError('网页跳转次数超过限制。','web_redirect');url=webUrl(new URL(result.location,url).href);continue;}
  return {url:url.href,bytes:result.bytes!,type:result.type!};
 }
 throw new WebError('网页无法读取。');
}
export async function fetchWeb(...args:Parameters<typeof fetchWebOnce>):Promise<FetchedWeb>{try{return await fetchWebOnce(...args);}catch(error){if(!args[1].signal.aborted&&(error as {name?:string})?.name==='AbortError')throw classifyWebTransport(error,{reason:{name:'TimeoutError'}} as AbortSignal);throw classifyWebTransport(error,args[1].signal);}}
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{const stop=()=>reject(new WebError('网页读取已停止或超时。','web_stopped'));if(signal.aborted)return stop();signal.addEventListener('abort',stop,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});}
