import type {ReadingBookmark} from './bookmark-types';
import {bookmarkDomRanges} from './bookmark-selection';
/** Custom highlights decorate ranges without extracting/wrapping any document text. */
export function applyBookmarkHighlights(article:HTMLElement,bookmarks:ReadingBookmark[]):()=>void{
 const css=globalThis.CSS as typeof CSS&{highlights?:Map<string,Highlight>};
 if(!css?.highlights||typeof Highlight==='undefined')return ()=>{};
 const ranges=bookmarks.flatMap(bookmark=>bookmarkDomRanges(article,bookmark.anchor)??[]);
 const highlight=new Highlight(...ranges);css.highlights.set('got-it-bookmarks',highlight);
 return ()=>{if(css.highlights?.get('got-it-bookmarks')===highlight)css.highlights.delete('got-it-bookmarks');};
}
