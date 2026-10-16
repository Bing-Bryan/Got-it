import type { Anchor } from '../types';
/** Bookmark-only ordered continuous segments; inquiry Anchor stays single-block. */
export interface BookmarkAnchor extends Anchor {segments?: Anchor[]}
export function bookmarkSegments(anchor:BookmarkAnchor):Anchor[]{return anchor.segments??[anchor];}
export function bookmarkQuote(anchor:BookmarkAnchor){return bookmarkSegments(anchor).map(a=>a.translation?.quote??a.quote).join('\n');}
export function bookmarkContext(anchor:BookmarkAnchor){const segments=bookmarkSegments(anchor),first=segments[0].translation??segments[0],last=segments.at(-1)!.translation??segments.at(-1)!;return {before:first.prefix,after:last.suffix};}
export function combineBookmarkAnchors(segments:Anchor[]):BookmarkAnchor {if(segments.length===1)return segments[0];const quote=segments.map(a=>a.quote).join('\n');const {translation:_,pdf:__,...first}=segments[0];return {...first,quote,start:0,end:quote.length,prefix:segments[0].prefix,suffix:segments.at(-1)!.suffix,segments};}
export interface ReadingBookmark {
  id: string; version: 1; createdAt: string; creationOperationId: string;
  entryId: string; revisionId: string; documentId: string; contentVersion: string;
  sourceKind: 'markdown' | 'pdf' | 'web'; sourceTitle: string; sourceUrl?: string;
  anchor: BookmarkAnchor; excerpt: string; contextBefore: string; contextAfter: string;
}
export interface BookmarkCreate { operationId: string; entryId: string; revisionId: string; anchor: BookmarkAnchor }
export interface BookmarkResult { bookmark: ReadingBookmark; created: boolean; revision: number }
export interface BookmarkPage { bookmarks: ReadingBookmark[]; total: number; revision: number; warnings: string[] }
export const BOOKMARK_LIMITS = { excerpt: 100_000, context: 240, records: 20_000, query: 1000 } as const;
export function bookmarkPosition(value: Pick<ReadingBookmark,'entryId'|'revisionId'|'anchor'>) {
  const a=value.anchor,t=a.translation;
  return JSON.stringify([value.entryId,value.revisionId,a.documentId,a.blockId,a.start,a.end,
    a.pdf ? [a.pdf.fileHash,a.pdf.page,a.pdf.rects,a.pdf.source,a.pdf.ocrId??null] : null,
    t ? [t.translationId,t.version,t.sourceVersion,t.blockId,t.start,t.end] : null,
    ...(a.segments?[a.segments.map(s=>[s.blockId,s.start,s.end,s.translation?[s.translation.translationId,s.translation.version,s.translation.sourceVersion,s.translation.start,s.translation.end]:null])]:[])]);
}
export const normalizedBookmarkText=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export function bookmarkSearchScore(bookmark:ReadingBookmark,query:string) {
  const q=normalizedBookmarkText(query);if(!q)return 1;
  const excerpt=normalizedBookmarkText(bookmark.excerpt),context=normalizedBookmarkText(bookmark.contextBefore+' '+bookmark.contextAfter),text=excerpt+' '+context;
  if(excerpt.includes(q))return 3;if(text.includes(q))return 2;
  const words=q.split(' ').filter(Boolean);
  if(words.length>1&&words.every(word=>text.includes(word)))return 1;
  // Chinese bigrams allow punctuation/wording gaps, never title or path matches.
  const grams=[...q.matchAll(/[\p{Script=Han}]{2}/gu)].map(m=>m[0]);
  if(grams.length>1&&grams.every(g=>text.includes(g)))return .5;
  return 0;
}
