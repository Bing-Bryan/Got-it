import { expect, it } from 'vitest';
import { searchLibraryNames } from './library-name-search';
import type { LibrarySummary } from './library-types';
const names = [
 {id:'z',filename:'Plan10.md',path:'/private/报告.md'},
 {id:'b',filename:'Plan2.pdf',path:'/files/b.pdf'},
 {id:'a',filename:'Plan2.md',path:'/files/a.md'},
 {id:'c',filename:'研究报告.md',path:'/files/report.md'},
 {id:'web',filename:'Claude Agent Tools',kind:'web',url:'https://example.com/report',path:null},
].map(e=>({...e,version:1,lastOpenedAt:'2026',historyCount:0})) as LibrarySummary[];
it('matches Chinese and English names only, preserving natural sort and source input',()=>{
 const before=JSON.stringify(names);
 expect(searchLibraryNames(names,' pLaN ').map(e=>e.filename)).toEqual(['Plan2.md','Plan2.pdf','Plan10.md']);
 expect(searchLibraryNames(names,'报告').map(e=>e.id)).toEqual(['c']);
 expect(searchLibraryNames(names,'AGENT').map(e=>e.id)).toEqual(['web']);
 expect(searchLibraryNames(names,'private')).toEqual([]);
 expect(searchLibraryNames(names,'example.com')).toEqual([]);
 expect(searchLibraryNames(names,'report')).toEqual([]);
 expect(searchLibraryNames(names,'   ')).toHaveLength(5);
 expect(JSON.stringify(names)).toBe(before);
});
it('keeps same-name ordering by path then id across source order changes',()=>{
 const entries=[{...names[0],id:'z',filename:'相同.md',path:'/b'},{...names[0],id:'b',filename:'相同.md',path:'/a'},{...names[0],id:'a',filename:'相同.md',path:'/a'}];
 expect(searchLibraryNames(entries,'相同').map(e=>e.id)).toEqual(['a','b','z']);
 expect(searchLibraryNames([...entries].reverse(),'').map(e=>e.id)).toEqual(['a','b','z']);
});
