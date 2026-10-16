import { useCallback, useRef, useState } from 'react';
import { libraryRequest } from './lib/library-client';
import type { BookmarkCreate, BookmarkResult } from './lib/bookmark-types';

/** Owns cross-selection feedback; identity always comes from the submitted request. */
export function useBookmarkFeedback() {
  const [failure, setFailure] = useState<{request:BookmarkCreate;error:string}|null>(null);
  const [notice, setNotice] = useState<BookmarkResult|null>(null);
  const [version, setVersion] = useState(0);
  const [retryingId, setRetryingId] = useState<string|null>(null);
  const latestOperation = useRef<string|null>(null);
  const retries = useRef(new Set<string>());
  const started = useCallback((request:BookmarkCreate) => { latestOperation.current=request.operationId;setNotice(null); }, []);
  const saved = useCallback((result:BookmarkResult, request:BookmarkCreate) => {
    setFailure(current => current?.request.operationId===request.operationId ? null : current);
    // All committed saves invalidate local lookups, but only the latest action owns its notice.
    if(latestOperation.current===request.operationId)setNotice(result);
    setVersion(n=>n+1);
  }, []);
  const failed = useCallback((request:BookmarkCreate,error:string) => {
    if(latestOperation.current===request.operationId)setFailure({request,error});
  }, []);
  const closeNotice = useCallback(()=>setNotice(null),[]);
  async function retry(onSaved?: (result:BookmarkResult,request:BookmarkCreate)=>void) {
    if(!failure||retries.current.has(failure.request.operationId))return;
    const request=failure.request;
    retries.current.add(request.operationId);started(request);setRetryingId(request.operationId);
    try { const result=await libraryRequest<BookmarkResult>('/bookmarks',request);(onSaved??saved)(result,request); }
    catch(error) { failed(request,error instanceof Error?error.message:'收藏失败，请重试。'); }
    finally { retries.current.delete(request.operationId);setRetryingId(current=>current===request.operationId?null:current); }
  }
  return {failure,notice,version,started,saved,failed,closeNotice,retry,
    retrying:!!failure&&retryingId===failure.request.operationId,
    closeFailure:()=>setFailure(null),changed:()=>setVersion(n=>n+1)};
}
