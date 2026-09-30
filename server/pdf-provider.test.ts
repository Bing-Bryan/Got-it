// @vitest-environment node
import {expect,it,vi} from 'vitest';import {access,readFile} from 'node:fs/promises';
import {parseInquiryRequest,ProviderService} from './providers';import {TEST_MODELS} from './test-support/model-catalog';
const image={entryId:'12345678-1234-1234-1234-123456789012',fileHash:'a'.repeat(64),cropId:'b'.repeat(64)};
const request=()=>parseInquiryRequest({providerId:'codex',intent:'explain',quote:'第 4 页 · 图表区域',question:'解释图表',context:'',history:[],image,modelConfig:{model:'gpt-5.6-sol',reasoningEffort:'medium'}});
it('rejects untrusted paths/URLs, invalid providers and missing bytes before any model request',async()=>{
 for(const bad of [{path:'/private/file'},{url:'https://example.com/pic'}, {...image,cropId:'../file'}])expect(()=>parseInquiryRequest({...request(),image:bad})).toThrow();
 expect(()=>parseInquiryRequest({...request(),providerId:'deepseek'})).toThrow();const turn=vi.fn();const service=new ProviderService({codexTurnImpl:turn});await expect(service.answer(request())).rejects.toMatchObject({code:'image_missing'});expect(turn).not.toHaveBeenCalled();
});
it('preserves identical image bytes in streaming, non-streaming, web follow-ups and retries; cleans up success/failure',async()=>{
 const paths:string[]=[];let shouldFail=false;const imageBytes=Buffer.from('server validated synthetic PNG');
 const turn=vi.fn(async opts=>{expect(opts.imagePaths).toHaveLength(1);paths.push(opts.imagePaths[0]);expect(await readFile(opts.imagePaths[0])).toEqual(imageBytes);expect(opts.prompt).toContain('不可信阅读材料');expect(opts.prompt).toContain('不能编造');expect(opts.prompt).not.toContain(image.cropId);if(shouldFail)throw new Error('rejected image');return {raw:JSON.stringify({answer:'合成图的可见关系，数字不清晰。',sources:[],evidenceStatus:'not-applicable'}),trace:''};});
 const service=new ProviderService({modelCatalog:async()=>TEST_MODELS,execFileImpl:async()=>({stdout:'Logged in using ChatGPT',stderr:''}),codexTurnImpl:turn});
 await service.answer(request(),{image:imageBytes});expect(turn.mock.calls[0][0].searchable).toBe(false);
 await service.answer({...request(),explanationMode:'web'},{image:imageBytes,onEvent:()=>{}});expect(turn.mock.calls[1][0].searchable).toBe(true);
 shouldFail=true;await expect(service.answer(request(),{image:imageBytes})).rejects.toThrow();shouldFail=false;await service.answer(request(),{image:imageBytes,onEvent:()=>{}});expect(turn).toHaveBeenCalledTimes(4);
 for(const path of paths)await expect(access(path)).rejects.toThrow();
});
it('does not silently replace explicitly text-only models',async()=>{
 const turn=vi.fn();const service=new ProviderService({modelCatalog:async()=>TEST_MODELS.map(m=>({...m,inputModalities:['text'] as Array<'text'|'image'>})),codexTurnImpl:turn});await expect(service.answer(request(),{image:Buffer.from('image')})).rejects.toMatchObject({code:'image_unsupported'});expect(turn).not.toHaveBeenCalled();
});

it('cleans image temporary files when a live turn is cancelled',async()=>{
 let path='';const c=new AbortController();const service=new ProviderService({modelCatalog:async()=>TEST_MODELS,execFileImpl:async()=>({stdout:'Logged in using ChatGPT',stderr:''}),codexTurnImpl:async opts=>{path=opts.imagePaths![0];await access(path);c.abort();throw new Error('cancelled');}});
 await expect(service.answer(request(),{image:Buffer.from('validated image'),signal:c.signal,onEvent:()=>{}})).rejects.toThrow();expect(path).toBeTruthy();await vi.waitFor(async()=>{await expect(access(path)).rejects.toThrow();});
});

it.each(['verify','entity'] as const)('passes the same authorized image into %s with its search policy',async intent=>{
 const turn=vi.fn(async opts=>{expect(await readFile(opts.imagePaths[0])).toEqual(Buffer.from('validated crop'));return {raw:JSON.stringify({answer:'结果',sources:[],evidenceStatus:'not-applicable'}),trace:''};});
 const service=new ProviderService({modelCatalog:async()=>TEST_MODELS,execFileImpl:async()=>({stdout:'Logged in',stderr:''}),codexTurnImpl:turn});
 await service.answer(parseInquiryRequest({...request(),intent}),{image:Buffer.from('validated crop'),onEvent(){}});
 expect(turn.mock.calls[0][0].searchable).toBe(true);expect(turn.mock.calls[0][0].prompt).toContain(intent==='verify'?'必须实际搜索':'介绍实体');
});
