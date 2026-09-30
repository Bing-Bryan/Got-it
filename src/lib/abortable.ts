/** Observe cancellation even when an underlying worker leaves its promise pending. */
export function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const stopped=()=>reject(signal.reason??new Error('操作已取消。'));
  if(signal.aborted)stopped();else signal.addEventListener('abort',stopped,{once:true});
  work.then(v=>{signal.removeEventListener('abort',stopped);if(signal.aborted)stopped();else resolve(v);},e=>{signal.removeEventListener('abort',stopped);reject(e);});
 });
}
