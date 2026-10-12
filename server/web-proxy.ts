import {connect as netConnect,isIP,type Socket} from 'node:net';
import {connect as tlsConnect,checkServerIdentity,type TLSSocket} from 'node:tls';
import {Agent,request,type RequestOptions} from 'node:https';
import type {IncomingMessage,ClientRequest} from 'node:http';
import {publicAddress} from './source-reader';
import {LibraryError} from './file-picker';
export interface LocalProxy {host:string;port:number}
const error=()=>new LibraryError('安全代理连接或公网 DNS 校验失败，未回退到未经校验的地址。',502,'web_proxy');
/** Safe retry classification: no proxy status, TLS identity or DNS-policy failure is transient. */
export function classifyWebTransport(errorValue:unknown,signal?:AbortSignal):Error{
 if(errorValue instanceof LibraryError)return errorValue;
 const e=errorValue as {code?:string;name?:string};
 if(['ECONNRESET','ETIMEDOUT','EPIPE','EAI_AGAIN'].includes(e?.code??'')||signal?.reason?.name==='TimeoutError'&&(e?.name==='AbortError'||e?.code==='ABORT_ERR'))return new LibraryError('公开网络连接暂时中断或超时。',502,'web_transport_transient');
 return errorValue instanceof Error?errorValue:error();
}
export function retryableWebTransport(errorValue:unknown):boolean{return (errorValue as {code?:string})?.code==='web_transport_transient';}
/** Only explicitly configured, credential-free loopback HTTP proxies are eligible. */
export function localWebProxy(env:NodeJS.ProcessEnv=process.env):LocalProxy|undefined{
 const value=env.HTTPS_PROXY??env.https_proxy??env.ALL_PROXY??env.all_proxy;
 if(!value)return;
 try{const u=new URL(value);if(u.protocol!=='http:'||u.username||u.password||!['127.0.0.1','[::1]','localhost'].includes(u.hostname)||u.pathname!=='/'||u.search||u.hash)throw error();const port=Number(u.port||80);if(!Number.isInteger(port)||port<1||port>65535)throw error();return{host:u.hostname==='localhost'?'127.0.0.1':u.hostname.replace(/^\[|\]$/g,''),port};}catch{throw error();}
}
export async function proxyTls(proxy:LocalProxy,address:string,hostname:string,signal:AbortSignal):Promise<TLSSocket>{
 if(isIP(address)!==4||!publicAddress(address))throw error();signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const socket=netConnect({host:proxy.host,port:proxy.port});let secured:TLSSocket|undefined;let header=Buffer.alloc(0);let finished=false;
  const stop=()=>fail(signal.reason?.name==='TimeoutError'?new LibraryError('公开网络连接超时。',502,'web_transport_transient'):error());const fail=(e:Error)=>{if(finished)return;finished=true;signal.removeEventListener('abort',stop);socket.destroy();secured?.destroy();reject(e);};
  signal.addEventListener('abort',stop,{once:true});socket.on('error',e=>fail(classifyWebTransport(e,signal)));
  socket.once('connect',()=>socket.write(`CONNECT ${address}:443 HTTP/1.1\r\nHost: ${address}:443\r\nConnection: keep-alive\r\n\r\n`));
  const receive=(chunk:Buffer)=>{
   header=Buffer.concat([header,chunk]);const end=header.indexOf('\r\n\r\n');if(header.length>16384){fail(error());return;}if(end<0)return;
   socket.removeListener('data',receive);if(!/^HTTP\/1\.[01] 200(?: |\r)/.test(header.toString('ascii',0,end))||header.length!==end+4){fail(error());return;}
   secured=tlsConnect({socket,servername:isIP(hostname)?undefined:hostname,rejectUnauthorized:true,checkServerIdentity:(_host,cert)=>checkServerIdentity(hostname,cert)});secured.on('error',e=>fail(classifyWebTransport(e,signal)));
   secured.once('secureConnect',()=>{if(finished)return;finished=true;signal.removeEventListener('abort',stop);socket.removeListener('error',fail);resolve(secured!);});
  };socket.on('data',receive);
 });
}
export function proxyRequest(proxy:LocalProxy,options:RequestOptions,callback:(r:IncomingMessage)=>void):ClientRequest{
 if(options.protocol!=='https:'||!options.signal||typeof options.hostname!=='string')throw error();
 const agent=new Agent({keepAlive:false});
 agent.createConnection=((_o:unknown,done:(e:Error|null,s?:Socket)=>void)=>{proxyTls(proxy,options.hostname!,String(options.servername??options.hostname),options.signal!).then(s=>done(null,s),(e)=>done(classifyWebTransport(e,options.signal)));return undefined;}) as typeof agent.createConnection;
 return request({...options,agent},callback);
}
/** Trusted DoH endpoint is itself reached at a fixed public IP with normal TLS verification. */
export async function proxyPublicDns(proxy:LocalProxy,host:string,signal:AbortSignal):Promise<{address:string;family:number}[]>{
 const answers=await Promise.all(['A','AAAA'].map(type=>new Promise<{address:string;family:number}[]>((resolve,reject)=>{
  const req=proxyRequest(proxy,{protocol:'https:',hostname:'1.1.1.1',servername:'cloudflare-dns.com',port:443,path:`/dns-query?name=${encodeURIComponent(host)}&type=${type}`,headers:{Host:'cloudflare-dns.com',Accept:'application/dns-json'},signal,maxHeaderSize:16384},res=>{
   if(res.statusCode!==200||!String(res.headers['content-type']??'').includes('application/dns-json')){res.destroy();reject(error());return;}
   let length=0;const chunks:Buffer[]=[];res.on('error',reject);res.on('data',(b:Buffer)=>{length+=b.length;if(length>65536){res.destroy(error());return;}chunks.push(b);});res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString());resolve(checkDnsAnswers(value,type));}catch{reject(error());}});
  });req.on('error',e=>reject(classifyWebTransport(e,signal)));req.end();
 })));
 const all=answers.flat();if(!all.length||!all.some(a=>a.family===4))throw error();return all.sort((a,b)=>a.family-b.family);
}
export function checkDnsAnswers(value:unknown,type:string):{address:string;family:number}[]{
 const v=value as {Status?:number;Answer?:{type:number;data:string}[]};if(!v||v.Status!==0||v.Answer!==undefined&&!Array.isArray(v.Answer))throw error();
 const result:{address:string;family:number}[]=[];
 for(const a of v.Answer??[]){if(!a||typeof a.data!=='string'||!Number.isInteger(a.type))throw error();if(a.type===5)continue;if(a.type!==1&&a.type!==28)throw error();const family=isIP(a.data);if(family!==(a.type===1?4:6)||!publicAddress(a.data))throw error();if(a.type!==(type==='A'?1:28))throw error();result.push({address:a.data,family});}
 return result;
}
