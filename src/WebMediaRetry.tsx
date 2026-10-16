import {useEffect,useState,useRef,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {RotateCw} from 'lucide-react';
import type {WebDocumentData} from './lib/web-data';
/** Controls contain no text nodes: source text, block identities and offsets stay unchanged. */
export function WebMediaRetry({article,web,documentKey,disabled,retry}:{article:RefObject<HTMLElement|null>;web:WebDocumentData;documentKey:string;disabled:boolean;retry:(id:string)=>Promise<void>}){
 const lock=useRef(false);
 const [targets,setTargets]=useState<HTMLElement[]>([]),[running,setRunning]=useState<string|null>(null),[failure,setFailure]=useState<{id:string;message:string}|null>(null);
 useEffect(()=>{setTargets([...(article.current?.querySelectorAll<HTMLElement>('[data-web-media-retry]')??[])]);},[article,documentKey,web]);
 async function run(id:string){if(lock.current)return;lock.current=true;setRunning(id);setFailure(null);try{await retry(id);}catch(e){setFailure({id,message:e instanceof Error?e.message:'图片重试失败，请再试。'});}finally{lock.current=false;setRunning(null);}}
 return <><span className="web-media-live" role="status" aria-live="polite">{failure?`图片重试失败：${failure.message}`:running?'正在重新获取图片。':''}</span>{targets.map(target=>{const id=target.dataset.webMediaRetry!,media=web.media.find(m=>m.id===id);if(!media||media.status!=='missing')return null;if(media.kind!=='image'||!media.sourceUrl)return createPortal(<span className="web-media-retry-unavailable" data-message="未保存可用原图地址，无法重试。" aria-label="未保存可用原图地址，无法重试。"/>,target,id);const label=running===id?'正在重试图片':`重试图片：${media.alt||'未命名图片'}`;return createPortal(<span className="web-media-retry-controls" contentEditable={false} onMouseDown={event=>event.preventDefault()}><button type="button" className="web-media-retry" aria-label={label} title={label} aria-busy={running===id} disabled={disabled||!!running} onClick={()=>void run(id)}><RotateCw size={17} aria-hidden="true"/></button>{failure?.id===id?<span className="web-media-retry-error" aria-hidden="true" data-message={failure.message}/>:null}</span>,target,id);})}</>;
}
