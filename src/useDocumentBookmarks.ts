import {useEffect,useState} from 'react';
import {libraryRequest} from './lib/library-client';
import type {BookmarkPage,ReadingBookmark} from './lib/bookmark-types';
export function useDocumentBookmarks(entryId:string|undefined,version:number){
 const [state,setState]=useState<{entryId?:string;bookmarks:ReadingBookmark[];error:string;loading:boolean}>({bookmarks:[],error:'',loading:false});
 useEffect(()=>{let cancelled=false;if(!entryId){setState({bookmarks:[],error:'',loading:false});return;}setState({entryId,bookmarks:[],error:'',loading:true});
 void(async()=>{try{const bookmarks:ReadingBookmark[]=[];let revision:number|undefined;for(let offset=0;;offset+=200){const page=await libraryRequest<BookmarkPage>(`/bookmarks?entryId=${encodeURIComponent(entryId)}&offset=${offset}&limit=200`);if(cancelled)return;if(revision!==undefined&&revision!==page.revision)throw new Error('收藏列表已变化，请重新读取本文收藏。');revision=page.revision;bookmarks.push(...page.bookmarks);if(bookmarks.length>=page.total)break;}if(!cancelled)setState({entryId,bookmarks,error:'',loading:false});}catch(e){if(!cancelled)setState({entryId,bookmarks:[],error:e instanceof Error?e.message:'本文收藏暂时无法读取。',loading:false});}})();return()=>{cancelled=true;};
 },[entryId,version]);
 return state.entryId===entryId?state:{entryId,bookmarks:[],error:'',loading:!!entryId};
}
