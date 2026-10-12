import {afterEach,expect,it,vi} from 'vitest';
import {libraryRequest} from './library-client';
vi.mock('./library-session',()=>({librarySession:async()=> 'synthetic-test-session',invalidateLibrarySession:vi.fn()}));
afterEach(()=>vi.unstubAllGlobals());
it('keeps the server interruption code and message for the caller',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:408,json:async()=>({error:'本批翻译请求超时',code:'translation_batch_timeout'})})));
 await expect(libraryRequest('/entries/test/translation-batches',{})).rejects.toMatchObject({status:408,code:'translation_batch_timeout',message:'本批翻译请求超时'});
});
