import {crc32} from 'node:zlib';
import {describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({chunks:[] as unknown[],calls:[] as unknown[],options:[] as unknown[]}));
vi.mock('openai',()=>({default:class{constructor(options:unknown){mock.options.push(options);}chat={completions:{create:async(body:unknown)=>{mock.calls.push(body);return(async function*(){for(const chunk of mock.chunks)yield chunk;})();}}};}}));
import {createHostedRunner,imageTokenReserve,parseHostedInquiry} from './hosted-model';
import {createHostedVerificationRunner,hostedVerificationPrompt,hostedWebExplanationPrompt} from './hosted-verification';
import {REGION_NO_TEXT_CONTEXT} from '../src/lib/pdf-data';
const request=()=>parseHostedInquiry({requestId:'request-1',intent:'explain',quote:'概念',context:'原文明确内容',question:'解释一下',history:[]});
const chunk=(content:string,finish_reason:string|null=null)=>({choices:[{delta:{content},finish_reason}]});
const usage={choices:[],usage:{prompt_tokens:1000,completion_tokens:100}};
describe('DeepSeek adapter controlled stream',()=>{
  it('uses the fixed endpoint/model, caps output, disables reasoning/retries and streams only decoded answer',async()=>{
    mock.chunks=[chunk('{"answer":"这是一段'),chunk('解释。","sources":[],"evidenceStatus":"not-applicable"}','stop'),usage];
    const deltas:string[]=[];const result=await createHostedRunner('fixture-server-secret')(request(),new AbortController().signal,d=>deltas.push(d));
    expect(deltas).toEqual(['这是一段','解释。']);expect(result.response.answer).toBe('这是一段解释。');expect(result.response.search?.status).toBe('not-executed');expect(result.usage).toEqual(usage.usage);
    expect(mock.options.at(-1)).toMatchObject({baseURL:'https://api.deepseek.com',maxRetries:0,timeout:60_000});
    expect(mock.calls.at(-1)).toMatchObject({model:'deepseek-flash',max_tokens:1500,thinking:{type:'disabled'},stream_options:{include_usage:true}});expect(JSON.stringify(mock.calls.at(-1))).not.toContain('fixture-server-secret');
  });
  it('rejects truncated, malformed and false verified output; local fence repair never retries the model',async()=>{
    for(const chunks of [[chunk('{"answer":"cut"}','length')],[chunk('not JSON','stop')],[chunk('{"answer":"claim","sources":[],"evidenceStatus":"supported"}','stop')],[chunk('{"answer":"claim","sources":[{"url":"https://example.com"}],"evidenceStatus":"not-applicable"}','stop')]]){
      mock.chunks=chunks;const before=mock.calls.length;await expect(createHostedRunner('fixture')(request(),new AbortController().signal,()=>{})).rejects.toThrow();expect(mock.calls.length-before).toBe(1);
    }
    mock.chunks=[chunk('```json\n{"answer":"修复格式","sources":[],"evidenceStatus":"not-applicable"}\n```','stop'),usage];
    const before=mock.calls.length;await expect(createHostedRunner('fixture')(request(),new AbortController().signal,()=>{})).resolves.toMatchObject({response:{answer:'修复格式'}});expect(mock.calls.length-before).toBe(1);
  });
  it('never silently processes web explanation or verification using the search-free runner',async()=>{
    const before=mock.calls.length;
    for(const special of [{...request(),intent:'explain' as const,explanationMode:'web' as const},{...request(),intent:'verify' as const}])await expect(createHostedRunner('fixture')(special,new AbortController().signal,()=>{})).rejects.toMatchObject({code:'search_unavailable'});
    expect(mock.calls.length).toBe(before);
  });
  it('rejects excessive output and an already aborted request without a completion',async()=>{
    mock.chunks=[chunk('x'.repeat(24001),'stop')];await expect(createHostedRunner('fixture')(request(),new AbortController().signal,()=>{})).rejects.toThrow('输出限制');
    const controller=new AbortController();controller.abort(new Error('stopped'));mock.chunks=[chunk('{"answer":"late"}','stop')];await expect(createHostedRunner('fixture')(request(),controller.signal,()=>{})).rejects.toThrow('stopped');
  });
});

// Minimal PNG header: signature + IHDR with the given dimensions.
const pngHeader=(width:number,height:number)=>{const b=Buffer.alloc(40);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b,0);b.writeUInt32BE(13,8);b.write('IHDR',12,'ascii');b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b.toString('base64');};
const regionBody=(image:unknown,extra:Record<string,unknown>={})=>({requestId:'request-1',intent:'explain',quote:'第 4 页 · 所选区域',context:'Max Logits 100',question:'右图稳定在多少？',history:[],image,...extra});
describe('hosted selected-region images',()=>{
  it('rejects images unless enabled, and rejects malformed, non-PNG or oversized images',()=>{
    expect(()=>parseHostedInquiry(regionBody({data:pngHeader(10,10)}))).toThrow(expect.objectContaining({code:'images_disabled'}));
    const corrupt=Buffer.from(pngHeader(10,10),'base64');corrupt[30]^=0xff;
    for(const bad of [{data:corrupt.toString('base64')},{},{data:pngHeader(10,10),url:'https://x'},{data:'not base64!'},{data:Buffer.from('GIF89a'.padEnd(40,'x')).toString('base64')},{data:pngHeader(5000,10)},{data:pngHeader(2000,2000)}])
      expect(()=>parseHostedInquiry(regionBody(bad),{images:true})).toThrow();
  });
  it('carries a valid image with a conservative token reservation and sends it as an image part',async()=>{
    const parsed=parseHostedInquiry(regionBody({data:pngHeader(1912,580)}),{images:true});
    expect(parsed.hostedImage).toMatchObject({width:1912,height:580,tokens:imageTokenReserve(1912*580)});
    expect(parsed.hostedImage!.tokens).toBeGreaterThan(1000);expect('image' in parsed).toBe(false);
    mock.chunks=[chunk('{"answer":"约 30","sources":[],"evidenceStatus":"not-applicable"}','stop'),usage];
    await createHostedRunner('fixture')(parsed,new AbortController().signal,()=>{});
    const content=(mock.calls.at(-1) as {messages:{content:unknown}[]}).messages[0].content as {type:string;text?:string;image_url?:{url:string;detail:string}}[];
    expect(content.map(p=>p.type)).toEqual(['text','image_url']);expect(content[0].text).toContain('框选的区域图片');
    expect(content[1].image_url).toEqual({url:`data:image/png;base64,${pngHeader(1912,580)}`,detail:'high'});
  });
  it('keeps text-only requests as plain text content',async()=>{
    mock.chunks=[chunk('{"answer":"文本","sources":[],"evidenceStatus":"not-applicable"}','stop'),usage];
    await createHostedRunner('fixture')(request(),new AbortController().signal,()=>{});
    expect(typeof (mock.calls.at(-1) as {messages:{content:unknown}[]}).messages[0].content).toBe('string');
  });
  it('searches region verification with OCR text, never the placeholder quote, and refuses an empty query',async()=>{
    const queries:string[]=[];const search=async(q:string)=>{queries.push(q);return [];};
    mock.chunks=[chunk('not JSON','stop')];
    const run=createHostedVerificationRunner('fixture',search as never,async()=>{throw new Error('no read');});
    await run(parseHostedInquiry(regionBody({data:pngHeader(100,100)},{intent:'verify',question:''}),{images:true}),new AbortController().signal,()=>{}).catch(()=>{});
    expect(queries).toEqual(['Max Logits 100']);
    // An empty region search is rejected while parsing, before any budget reservation.
    expect(()=>parseHostedInquiry(regionBody({data:pngHeader(100,100)},{intent:'verify',question:'',context:REGION_NO_TEXT_CONTEXT}),{images:true})).toThrow(expect.objectContaining({code:'query_empty'}));
    expect(queries).toHaveLength(1);
  });
  it('tells verification and web explanation models that a region image is attached',()=>{
    const region=parseHostedInquiry(regionBody({data:pngHeader(100,100)},{intent:'verify'}),{images:true});
    expect(hostedVerificationPrompt(region,[])).toContain('框选的区域图片');
    expect(hostedWebExplanationPrompt({...region,intent:'explain',explanationMode:'web'},[])).toContain('框选的区域图片');
    const {image:_,...textOnly}=regionBody(undefined,{intent:'verify'});expect(hostedVerificationPrompt(parseHostedInquiry(textOnly),[])).not.toContain('框选的区域图片');
  });
});
