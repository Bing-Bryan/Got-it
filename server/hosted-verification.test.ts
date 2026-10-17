import {describe,expect,it,vi} from 'vitest';
const model=vi.hoisted(()=>({output:{} as unknown,calls:[] as unknown[]}));
vi.mock('openai',()=>({default:class{chat={completions:{create:async(body:unknown)=>{model.calls.push(body);return(async function*(){yield {choices:[{delta:{content:JSON.stringify(model.output)},finish_reason:'stop'}]};yield {choices:[],usage:{prompt_tokens:1500,completion_tokens:500}};})();}}};}}));
import {createHostedVerificationRunner,hostedVerificationPrompt,normalizeHostedVerification,normalizeHostedWebExplanation} from './hosted-verification';
import {parseHostedInquiry} from './hosted-model';
import {ReadError} from './source-reader';
const candidate={id:'source-1',title:'Research',url:'https://example.org/study',summary:'A search-generated summary is not a verified quotation.'};
const excerpt='This study reports a measured value of 25 percent in 2026.';
function output(){return {answer:'该研究提供局部依据，但须区分样本与口径。',sources:[{id:'source-1',excerpt,relation:'supports',applicability:'direct',scope:'2026年特定研究样本',origin:'original',reliability:'strong',reliabilityReasons:['提供研究方法和测量范围']}],verification:{verdict:'supported',summary:'研究支持相应范围内的表述。',reason:'仅适用于文中研究样本。',readingAdvice:'注意范围限制。',claims:[{text:'测得25%',verdict:'supported',sourceIds:['source-1']}]}};}
const request=()=>parseHostedInquiry({requestId:'verify-1',intent:'verify',quote:'研究声称测得25%。',context:'2026年的研究。',question:'查找出处',history:[]});
describe('hosted verification pipeline, controlled model/search/page fixtures',()=>{
 it('searches, safely reads before prompting, verifies cached original text and preserves three distinct states',async()=>{
  model.output=output();const progress:string[]=[];let reads=0;
  const run=createHostedVerificationRunner('fixture',async()=>[candidate],async()=>{reads++;return {url:candidate.url,text:excerpt};});
  const result=await run(request(),new AbortController().signal,()=>{},p=>progress.push(p));
  expect(progress).toEqual(['search-started','search-completed','checking-sources']);expect(reads).toBe(1);expect(result.response.search?.status).toBe('executed');expect(result.response.sources[0].retrievalStatus).toBe('matched');expect(result.response.verification?.verdict).toBe('supported');
  expect(JSON.stringify(model.calls.at(-1))).toContain('summary只是搜索摘要');
 });
 it('matching quotation cannot promote a model-qualified claim; unread summary cannot become verified evidence',async()=>{
  model.output=output();(model.output as ReturnType<typeof output>).verification.verdict='partial';(model.output as ReturnType<typeof output>).verification.claims[0].verdict='partial';
  const run=createHostedVerificationRunner('fixture',async()=>[candidate],async()=>({url:candidate.url,text:excerpt}));const result=await run(request(),new AbortController().signal,()=>{});expect(result.response.sources[0].retrievalStatus).toBe('matched');expect(result.response.verification?.verdict).toBe('partial');
  model.output=output();const unread=await createHostedVerificationRunner('fixture',async()=>[candidate],async()=>{throw new ReadError('unavailable','blocked private address');})(request(),new AbortController().signal,()=>{});expect(unread.response.sources[0].retrievalStatus).toBe('unavailable');expect(unread.response.verification?.verdict).not.toBe('supported');
 });
 it('rejects invented URLs or source IDs and downgrades nonmatching quotations',async()=>{
  const c={...candidate,text:excerpt,status:'read' as const};const value=output();value.sources[0].id='invented';expect(()=>normalizeHostedVerification(value,request(),[c])).toThrow();
  const withUrl={...output(),sources:[{...output().sources[0],url:'http://127.0.0.1/private'}]};expect(()=>normalizeHostedVerification(withUrl,request(),[c])).toThrow();
  model.output=output();const result=await createHostedVerificationRunner('fixture',async()=>[candidate],async()=>({url:candidate.url,text:'Unrelated material with no matching original quotation.'}))(request(),new AbortController().signal,()=>{});expect(result.response.sources[0].retrievalStatus).toBe('mismatch');expect(result.response.verification?.verdict).not.toBe('supported');
 });
 it('zero results records executed without evidence; search failure never invokes model fallback',async()=>{
  model.output={...output(),sources:[],verification:{...output().verification,verdict:'insufficient',claims:[]}};
  const zero=await createHostedVerificationRunner('fixture',async()=>[])(request(),new AbortController().signal,()=>{});expect(zero.response.search).toMatchObject({status:'executed',completedSearches:1});expect(zero.response.sources).toEqual([]);expect(zero.response.verification?.verdict).toBe('insufficient');
  const before=model.calls.length;await expect(createHostedVerificationRunner('fixture',async()=>{throw new Error('search unavailable');})(request(),new AbortController().signal,()=>{})).rejects.toThrow('search unavailable');expect(model.calls.length).toBe(before);
 });
 it('web explanation actually searches and reads at most two sources while preserving explanation semantics',async()=>{
  const web=parseHostedInquiry({requestId:'web-1',intent:'explain',explanationMode:'web',quote:'QK-Clip',context:'A model training technique.',question:'联网补充解释',history:[]});
  const value={answer:'QK-Clip在这里用于约束训练中的注意力logits，细节以本轮取得材料为限。',sources:[output().sources[0]],evidenceStatus:'not-applicable',verification:null};
  model.output=value;let searches=0,reads=0;const progress:string[]=[];
  const result=await createHostedVerificationRunner('fixture',async()=>{searches++;return Array.from({length:5},(_,i)=>({...candidate,id:`source-${i+1}`,url:`https://example.org/${i}`}));},async(url)=>{reads++;return {url,text:excerpt};})(web,new AbortController().signal,()=>{},p=>progress.push(p));
  expect(searches).toBe(1);expect(reads).toBe(2);expect(progress).toEqual(['search-started','search-completed','checking-sources']);expect(result.response.answer).toBe(value.answer);expect(result.response.evidenceStatus).toBe('not-applicable');expect(result.response.verification).toBeUndefined();expect(result.response.search?.status).toBe('executed');expect(result.response.sources[0].retrievalStatus).toBe('matched');
  const sent=JSON.stringify(model.calls.at(-1));expect(sent).toContain('围绕原文概念补充，不作真假裁决');expect(sent).toContain('sources最多两条');
  expect(()=>normalizeHostedWebExplanation({...value,verification:output().verification},[{...candidate,text:excerpt,status:'read'}])).toThrow();
  const before=model.calls.length;await expect(createHostedVerificationRunner('fixture',async()=>{throw new Error('search failure, no fallback');})(web,new AbortController().signal,()=>{})).rejects.toThrow('search failure');expect(model.calls.length).toBe(before);
 });
 it('schema diagnostics expose only static failure branches and field types, never values or unknown field names',()=>{
  const candidates=[{...candidate,text:excerpt,status:'read' as const}];
  for(const [value,branch] of [[{answer:'secret answer',sources:[],evidenceStatus:'supported'},'web-invalid-evidence-status'],[{answer:'secret answer',sources:[],evidenceStatus:'not-applicable',verification:{summary:'secret claims'}},'web-unexpected-verification'],[{answer:'secret answer',sources:[],evidenceStatus:'not-applicable','secret-verdict-name':'secret-value'},'web-verdict-like-root-fields']] as const){
   try{normalizeHostedWebExplanation(value,candidates);throw new Error('expected schema failure');}catch(error){const diagnostic=(error as Error&{schemaDiagnostic:unknown}).schemaDiagnostic;expect(diagnostic).toMatchObject({branch,rootType:'object'});expect(JSON.stringify(diagnostic)).not.toContain('secret');}
  }
 });
 it('limits reads to three, constrains complete prompt input and cancels outstanding page reads',async()=>{
  model.output=output();let reads=0;await createHostedVerificationRunner('fixture',async()=>Array.from({length:8},(_,i)=>({...candidate,id:`source-${i+1}`,url:`https://example.org/${i}`})),async(url)=>{reads++;return {url,text:excerpt};})(request(),new AbortController().signal,()=>{});expect(reads).toBe(3);
  const prompt=hostedVerificationPrompt(request(),Array.from({length:3},()=>({...candidate,text:'原文'.repeat(100000),status:'read'})));expect(Buffer.byteLength(prompt)+128).toBeLessThanOrEqual(8000);
  const controller=new AbortController();let started!:()=>void;const ready=new Promise<void>(r=>started=r);const before=model.calls.length;
  const pending=createHostedVerificationRunner('fixture',async()=>[candidate],async()=>{started();return new Promise(()=>{});})(request(),controller.signal,()=>{});await ready;controller.abort(new Error('stop reading'));await expect(pending).rejects.toThrow('stop reading');expect(model.calls.length).toBe(before);
 });
});

describe('bounded normalization of observed structured-output drift',()=>{
 const read=[{...candidate,text:'x',status:'read' as const}];
 const webSource=(e:string)=>({id:'source-1',excerpt:e,relation:'related',applicability:'background',scope:'',origin:'secondary',reliability:'moderate',reliabilityReasons:['具体依据']});
 const web=(extra:Record<string,unknown>={},e='A short verbatim excerpt from the page.')=>({answer:'解释内容',sources:[webSource(e)],evidenceStatus:'not-applicable',verification:null,...extra});
 it('drops a harmless extra root field such as "type" in web explanations and verification',()=>{
  expect(normalizeHostedWebExplanation(web({type:'web_explanation'}),read as never).answer).toBe('解释内容');
  expect(normalizeHostedVerification({...output(),type:'verification'},request(),read as never).answer).toBe(output().answer);
 });
 it('still fails verdict-like extra root fields instead of silently accepting a judgement',()=>{
  for(const key of ['verdict','claims','verification_result','evidence','supported'])
   expect(()=>normalizeHostedWebExplanation(web({[key]:'supported'}),read as never)).toThrow('结构化输出无效');
  expect(()=>normalizeHostedVerification({...output(),overallVerdict:'supported'},request(),read as never)).toThrow('结构化输出无效');
 });
 it('cuts an over-long verbatim excerpt to its first 300 characters without adding text',()=>{
  const long='一'.repeat(200)+'b'.repeat(278);
  const [source]=normalizeHostedWebExplanation(web({},long),read as never).sources;
  expect(source.excerpt).toBe(long.slice(0,300));expect(long.startsWith(source.excerpt!)).toBe(true);
 });
 it('reports content-free diagnostics for invalid sources',()=>{
  let caught:any;try{normalizeHostedWebExplanation({...web(),sources:[{...webSource('ok text here'),relation:'maybe'}]},read as never);}catch(e){caught=e;}
  expect(caught.schemaDiagnostic).toEqual({branch:'source-invalid-enum',index:0,field:'relation',valueType:'string'});
  expect(JSON.stringify(caught.schemaDiagnostic)).not.toContain('maybe');
 });
});
