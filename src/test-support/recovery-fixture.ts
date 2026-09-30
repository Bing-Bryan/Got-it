import { createInitialWorkspace } from '../sample';
import type { Workspace } from '../types';
import type { LibraryEntry } from '../lib/library-types';
import type { ReadingDraft } from '../lib/reading-recovery';
export function readingFixture(name='测试.md'): Workspace {
  const w=createInitialWorkspace();
  w.document={...w.document,kind:"markdown",pdf:undefined,id:'doc-fixture',filename:name,markdown:'# 测试\n\n阅读内容',isDemo:false};
  w.inquiries=[{id:'i',intent:'explain',question:'解释阅读内容',anchor:{documentId:w.document.id,blockId:'block',headingPath:[],quote:'阅读内容',prefix:'',suffix:'',start:0,end:4,matchStatus:'matched',textVersion:2},status:'ready',messages:[{id:'m',role:'assistant',content:'原来的回答',createdAt:'2026',completion:'complete',sources:[{id:'s',title:'测试来源',url:'https://example.com',domain:'example.com',retrievalStatus:'not-read'}],evidenceStatus:'partial'}],understanding:'',createdAt:'2026',updatedAt:'2026'}];
  return w;
}
export function editReading(w:Workspace,text:string): Workspace { const next=structuredClone(w);next.inquiries[0].messages[0].content=text;return next; }
export function draftFixture(e:LibraryEntry,text='尚未保存的回答'): ReadingDraft {
  return {id:crypto.randomUUID(),entryId:e.id,version:e.version,revisionId:e.revisionId,baseDigest:e.contentDigest,workspace:editReading(e.workspace,text),position:{ratio:.2}};
}
