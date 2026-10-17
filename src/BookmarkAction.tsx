import {track} from './lib/hosted-usage';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { libraryRequest } from './lib/library-client';
import type { BookmarkCreate, BookmarkResult, ReadingBookmark } from './lib/bookmark-types';
import type { BookmarkAnchor } from './lib/bookmark-types';
export function BookmarkAction({entryId,revisionId,anchor,disabled,onSaved,prepareEntry,version=0,onFailed,onStarted,iconOnly=false}:{entryId:string;revisionId:string;anchor:BookmarkAnchor;prepareEntry?:()=>Promise<{id:string;revisionId:string}>;disabled?:boolean;onSaved:(result:BookmarkResult,request:BookmarkCreate)=>void;onStarted?:(request:BookmarkCreate)=>void;iconOnly?:boolean;version?:number;onFailed?:(request:BookmarkCreate,error:string)=>void}) {
 const [saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const operation=useRef<BookmarkCreate|null>(null),sequence=useRef(0);
 const identity=JSON.stringify([entryId,revisionId,anchor]);
 const anchorIdentity=JSON.stringify(anchor),currentAnchor=useRef(anchorIdentity),alive=useRef(true);currentAnchor.current=anchorIdentity;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{const seq=++sequence.current;operation.current=null;setSaved(false);setBusy(false);setError('');if(!entryId)return;void libraryRequest<{bookmark:ReadingBookmark|null}>('/bookmarks/lookup',{entryId,revisionId,anchor}).then(r=>{if(sequence.current===seq)setSaved(!!r.bookmark);}).catch(()=>{});return()=>{sequence.current++;};},[identity,version]);
 async function save(){if(busy||saved||disabled)return;const seq=sequence.current;setBusy(true);setError('');let request:BookmarkCreate|undefined;const nativeSelection=window.getSelection()?.toString();
 try{const target=prepareEntry?await prepareEntry():{id:entryId,revisionId};if(prepareEntry&&(!alive.current||currentAnchor.current!==anchorIdentity||window.getSelection()?.toString()!==nativeSelection))return;request=operation.current??={operationId:crypto.randomUUID(),entryId:target.id,revisionId:target.revisionId,anchor};onStarted?.(request);const result=await libraryRequest<BookmarkResult>('/bookmarks',request);if(seq===sequence.current)setSaved(true);track('bookmark-save');onSaved(result,request);}catch(e){const message=e instanceof Error?e.message:'收藏失败，请重试。';if(seq===sequence.current)setError(message);if(request)onFailed?.(request,message);}finally{if(seq===sequence.current)setBusy(false);}}

 return <span className="bookmark-action"><button type="button" className={iconOnly?"bookmark-icon":""} aria-label={saved?"已收藏":busy?"正在保存收藏":error?"重试收藏":"收藏选中文字"} title={saved?"已收藏":error?"重试收藏":"收藏选中文字"} disabled={disabled||busy||saved} onClick={()=>void save()}>{saved?<BookmarkCheck size={14} aria-hidden="true"/>:<Bookmark size={14} aria-hidden="true"/>}{!iconOnly?(saved?'已收藏':busy?'保存中…':error?'重试收藏':'收藏'):null}</button>{error?<span className="bookmark-save-error" role="alert">{error}</span>:null}</span>;
}
