import {trialId} from './runtime-mode';

/** Per-operation capability; intentionally memory-only, never a URL, workspace or backup field. */
const tokens=new Map<string,string>();
const controllers=new Map<string,AbortController>();
function token(id:string){let value=tokens.get(id);if(!value){value=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');tokens.set(id,value);}return value;}
export function cancelHostedOperation(id:string){controllers.get(id)?.abort(new DOMException('操作已停止','AbortError'));}
export async function hostedOperationFetch(path:string,id:string,body?:unknown,parent?:AbortSignal):Promise<Response>{
 const controller=new AbortController();controllers.set(id,controller);
 try{
  const response=await fetch('/api/hosted'+path,{method:body===undefined?'GET':'POST',headers:{'X-Trial-Id':trialId(),'X-Hosted-Operation-Token':token(id),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:parent?AbortSignal.any([parent,controller.signal]):controller.signal});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw Object.assign(new Error(result.error||'托管操作失败，请重试。'),{status:response.status,code:result.code});}
  return response;
 }finally{if(controllers.get(id)===controller)controllers.delete(id);}
}
export async function hostedOperationRequest<T>(path:string,id:string,body?:unknown):Promise<T>{return (await hostedOperationFetch(path,id,body)).json();}
export function releaseHostedOperation(id:string){tokens.delete(id);controllers.delete(id);}
