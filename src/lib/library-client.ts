import {librarySession,invalidateLibrarySession} from "./library-session";
export {librarySession} from "./library-session";
export class LibraryClientError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function libraryRequest<T>(path = "", body?: unknown, retry = true): Promise<T> {
  const response = await fetch(`/api/library${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-Got-It-Session": await librarySession() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.status === 401 && retry) { invalidateLibrarySession(); return libraryRequest(path, body, false); }
  const result = await response.json();
  if (!response.ok) throw new LibraryClientError(result.error || "阅读操作失败，请重试。", response.status);
  return result as T;
}

export async function libraryBinary(path:string,body?:Blob,retry=true):Promise<Response>{
 const response=await fetch('/api/library'+path,{method:body?'POST':'GET',headers:{'X-Got-It-Session':await librarySession(),...(body?{'Content-Type':body.type}: {})},...(body?{body}:{})});
 if(response.status===401&&retry){invalidateLibrarySession();return libraryBinary(path,body,false);}
 if(!response.ok){const result=await response.json();throw new LibraryClientError(result.error||'文件传输失败。',response.status);}return response;
}
