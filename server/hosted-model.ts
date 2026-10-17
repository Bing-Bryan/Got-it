import OpenAI from 'openai';
import {crc32} from 'node:zlib';
import {AnswerDecoder} from './codex-stream';
import type {InquiryRequest, InquiryResponse} from '../src/types';
import {READING_BASE_INSTRUCTIONS, readingMaterials, refinementInstruction} from './prompt-materials';
import {HostedError, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS} from './hosted-budget';
import {HOSTED_IMAGE_MAX_BYTES, REGION_NO_TEXT_CONTEXT} from '../src/lib/pdf-data';
import {REGION_MAX_PIXELS, REGION_MAX_SIDE} from '../src/lib/pdf-region';

// A user-selected PDF region, validated and carried as a data URL.
export interface HostedImage {dataUrl:string;width:number;height:number;tokens:number}
export type HostedInquiry=InquiryRequest&{hostedImage?:HostedImage};
// Observed deepseek-flash usage stayed under ~700 tokens per megapixel. A settled
// overrun blocks the whole day, so reserve well above that (2.5 MP -> 6750 tokens).
export const imageTokenReserve=(pixels:number)=>Math.ceil(pixels/400)+500;
export const IMAGE_PROMPT_NOTE='本次附有用户在 PDF 中框选的区域图片，以图片为主要依据；quote 只是区域位置说明，context 中的识别文字只是辅助，可能有误。看不清或无法确定的数值要明确说明，不要猜测。';
const PNG_SIGNATURE=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
function parseHostedImage(value:unknown):HostedImage{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='data'))throw new HostedError('图片格式无效',400,'invalid_image');
  const data=(value as {data:unknown}).data;
  if(typeof data!=='string'||data.length>Math.ceil(HOSTED_IMAGE_MAX_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw new HostedError('图片格式无效',400,'invalid_image');
  const bytes=Buffer.from(data,'base64');
  if(bytes.length<33||bytes.length>HOSTED_IMAGE_MAX_BYTES||!bytes.subarray(0,8).equals(PNG_SIGNATURE)||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||crc32(bytes.subarray(12,29))!==bytes.readUInt32BE(29))throw new HostedError('图片格式无效',400,'invalid_image');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>REGION_MAX_SIDE||height>REGION_MAX_SIDE||width*height>REGION_MAX_PIXELS*1.01)throw new HostedError('图片尺寸超过限制，请缩小框选范围',413,'image_limit');
  return {dataUrl:`data:image/png;base64,${data}`,width,height,tokens:imageTokenReserve(width*height)};
}

export const HOSTED_MODEL='deepseek-flash';
export const usesHostedSearch=(request:InquiryRequest)=>request.intent==='verify'||request.intent==='explain'&&request.explanationMode==='web';
// A selected region's quote is a placeholder; its searchable text is the OCR context.
export function hostedSearchQuery(request:HostedInquiry):string{
  const basis=request.hostedImage?(request.context===REGION_NO_TEXT_CONTEXT?'':request.context):request.quote;
  return [basis,request.question].join(' ').replace(/https?:\/\/\S+/gi,' ').replace(/\s+/g,' ').trim().slice(0,256);
}
export function hostedPrompt(request:HostedInquiry) {
  const intent=request.intent==='ask'?'准确回答 question 中的具体阅读问题，结合选区和历史解释代词，不替换为泛泛介绍。':request.intent==='entity'?'说明是什么、做什么和与文章的关系；未知信息明确不确定。':'结合选区和上下文给出通俗解释、必要例子和原文中的作用。';
  return [READING_BASE_INSTRUCTIONS,intent,...(request.hostedImage?[IMAGE_PROMPT_NOTE]:[]),'先直接回答核心问题，用简体中文短段落。只能依据提供的选区、有限上下文和追问历史；没有搜索或来源核对能力，不能声称已搜索或已查证。材料不足时明确缺口，不猜测最新事实。返回 JSON 对象，且仅含 answer（非空字符串）、sources（空数组）、evidenceStatus（not-applicable）。',refinementInstruction({...request,intent:request.intent==='why'?'explain':request.intent}),readingMaterials(request)].join('\n\n');
}
export function parseHostedInquiry(value:unknown,options:{images?:boolean}={}):HostedInquiry {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HostedError('请求格式错误');
  const v=value as Record<string,unknown>;
  const keys=['requestId','intent','quote','context','question','history','readingScope','explanationMode','scope','round','parentMessageId',...(options.images?['image']:[])];
  if(v.image!==undefined&&!options.images)throw new HostedError('体验版读图暂未开启',400,'images_disabled');
  if(Object.keys(v).some(k=>!keys.includes(k)))throw new HostedError('请求包含不允许的字段');
  if(typeof v.requestId!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(v.requestId))throw new HostedError('请求标识无效');
  if(!['explain','ask','entity','verify'].includes(String(v.intent)))throw new HostedError('体验版暂不支持此能力');
  if(v.readingScope!==undefined&&v.readingScope!=='document')throw new HostedError('阅读范围无效');
  if(v.explanationMode!==undefined&&v.explanationMode!=='local'&&!(v.intent==='explain'&&v.explanationMode==='web'))throw new HostedError('解释模式无效');
  if(v.scope!==undefined&&v.scope!=='initial')throw new HostedError('体验版暂仅支持本轮查证');
  if(v.round!==undefined&&(!Number.isInteger(v.round)||Number(v.round)<1||Number(v.round)>10))throw new HostedError('查证轮次无效');
  if(v.parentMessageId!==undefined&&(typeof v.parentMessageId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v.parentMessageId)))throw new HostedError('追问标识无效');
  for(const k of ['quote','context','question'])if(typeof v[k]!=='string')throw new HostedError('阅读内容格式错误');
  if(!(v.quote as string).trim()&&!(v.question as string).trim())throw new HostedError('请提供选区或问题');
  if(!Array.isArray(v.history)||v.history.length>8||v.history.some(h=>!h||typeof h!=='object'||Object.keys(h).some(k=>!['role','content'].includes(k))||!['user','assistant'].includes(h.role)||typeof h.content!=='string'))throw new HostedError('追问历史格式错误');
  const {image,...rest}=v;
  const request={...rest,documentTitle:'',providerId:'deepseek',...(image!==undefined?{hostedImage:parseHostedImage(image)}:{})} as unknown as HostedInquiry;
  // Reject an empty search before any quota or budget is reserved.
  if(usesHostedSearch(request)&&!hostedSearchQuery(request))throw new HostedError('请提供可以查找的主张或问题',400,'query_empty');
  // UTF-8 byte count is a deliberately conservative upper bound for tokenizer input,
  // including application instructions, JSON escaping and chat framing overhead.
  if(Buffer.byteLength(hostedPrompt(request),'utf8')+128>MAX_INPUT_TOKENS)throw new HostedError('选区和上下文过长，请缩小范围',413,'input_limit');
  return request;
}
export type HostedRunner=(request:HostedInquiry,signal:AbortSignal,onDelta:(delta:string)=>void,onProgress?:(progress:'search-started'|'search-completed'|'checking-sources')=>void)=>Promise<{response:InquiryResponse;usage?:{prompt_tokens:number;completion_tokens:number}}>;
export function createHostedJsonModel(apiKey:string,limits={input:MAX_INPUT_TOKENS,output:MAX_OUTPUT_TOKENS}) {
  const client=new OpenAI({apiKey,baseURL:'https://api.deepseek.com',maxRetries:0,timeout:60_000});
  return async(prompt:string,signal:AbortSignal,onDelta:(delta:string)=>void,image?:HostedImage)=>{
    signal.throwIfAborted();
    if(Buffer.byteLength(prompt,'utf8')+128>limits.input)throw new HostedError('模型上下文超过限制',413,'input_limit');
    const stream=await client.chat.completions.create({model:HOSTED_MODEL,messages:[{role:'user',content:image?[{type:'text',text:prompt},{type:'image_url',image_url:{url:image.dataUrl,detail:'high'}}]:prompt}],response_format:{type:'json_object'},max_tokens:limits.output,stream:true,stream_options:{include_usage:true},...{thinking:{type:'disabled'}}} as Parameters<typeof client.chat.completions.create>[0]&{stream:true}, {signal});
    const decoder=new AnswerDecoder();
    let raw='',usage:{prompt_tokens:number;completion_tokens:number}|undefined,finish:string|null=null;
    for await(const chunk of stream){
      if(signal.aborted)throw signal.reason;
      if(chunk.usage)usage={prompt_tokens:chunk.usage.prompt_tokens,completion_tokens:chunk.usage.completion_tokens};
      const choice=chunk.choices[0];if(choice?.finish_reason)finish=choice.finish_reason;
      const text=choice?.delta.content||'';raw+=text;
      const delta=decoder.push(text);if(delta)onDelta(delta);
      if(Buffer.byteLength(raw,'utf8')>Math.max(24_000,limits.output*16))throw new HostedError('回答超过输出限制',502,'output_limit');
    }
    if(finish!=='stop')throw new HostedError('模型回答未完整结束，请重试',502,'model_incomplete');
    let parsed:unknown;
    // A single local repair permits a surrounding Markdown fence; no paid retry.
    try{parsed=JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1'));}catch{throw new HostedError('模型结构化输出无效，请重试',502,'model_invalid_response');}
    return {data:parsed as Record<string,unknown>,usage};
  };
}
export function createHostedRunner(apiKey:string):HostedRunner {
  const model=createHostedJsonModel(apiKey);
  return async(request,signal,onDelta)=>{
    if(usesHostedSearch(request))throw new HostedError('联网请求必须使用真实搜索服务',503,'search_unavailable');
    const {data,usage}=await model(hostedPrompt(request),signal,onDelta,request.hostedImage);
    if(!data||typeof data!=='object'||Object.keys(data).some(k=>!['answer','sources','evidenceStatus'].includes(k))||typeof data.answer!=='string'||!data.answer.trim()||!Array.isArray(data.sources)||data.sources.length||data.evidenceStatus!=='not-applicable')throw new HostedError('模型结构化输出无效，请重试',502,'model_invalid_response');
    const answer=data.answer.trim();
    return {usage,response:{answer,sources:[],evidenceStatus:'not-applicable',search:{status:'not-executed',completedSearches:0,failedSearches:0},mode:'live',providerId:'deepseek',providerName:'体验版默认模型',model:HOSTED_MODEL}};
  };
}
