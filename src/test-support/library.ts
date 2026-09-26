import type { LibraryEntry } from "../lib/library-types";
import type { Workspace } from "../types";
import { restoreWorkspace, STORAGE_KEY } from "../lib/storage";
let entries: LibraryEntry[] = [], active: string|null=null;
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
export function resetTestLibrary() { entries=[];active=null;localStorage.clear(); }
export function testWorkspace(): Workspace {
  const key=Object.keys(localStorage).find(k=>k.startsWith("got-it.library.draft.v2.") && k.endsWith(`.${active}`));
  const raw=localStorage.getItem(key ?? "got-it.library.draft.v1");
  if(raw)return JSON.parse(raw).workspace;
  const workspace=entries.find(e=>e.id===active)?.workspace ?? JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  const preferences=JSON.parse(localStorage.getItem("got-it.model-preferences.v1") ?? "{}");
  return {...workspace,...preferences};
}
export async function testLibraryRequest(path="",body?:Record<string,any>) {
  if(!path)return {entries:entries.map(e=>({id:e.id,version:e.version,filename:e.workspace.document.filename,path:null,lastOpenedAt:e.lastOpenedAt,historyCount:e.history.length})),activeId:active,warnings:[],nativePicker:true};
  if(path==="/recoveries")return [];
  if(path==="/choose")return null;
  if(path==="/entries"){
    const w=restoreWorkspace(body!.workspace)!;
    const old=entries.find(e=>e.creationKey===body!.creationKey);if(old)return copy(old);
    const e:LibraryEntry={id:crypto.randomUUID(),version:1,revisionId:crypto.randomUUID(),workspace:w,position:{ratio:0},source:null,history:[],updatedAt:"2026",lastOpenedAt:"2026",creationKey:body!.creationKey};entries.push(e);return copy(e);
  }
  const [,,id,op]=path.split("/");const e=entries.find(e=>e.id===id);if(!e)throw new Error("找不到阅读条目");
  if(op==="check")return {status:"unlinked",message:"未关联原文件"};
  if(op==="activate"){active=id;e.version++;}
  if(op==="save"){if(body!.expectedVersion!==e.version)throw new Error("冲突");e.workspace=restoreWorkspace(body!.workspace)!;e.position=body!.position;e.version++;}
  return copy(e);
}
