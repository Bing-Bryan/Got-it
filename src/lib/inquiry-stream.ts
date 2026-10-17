import {copySearch} from './evidence';
import type {SearchTrace} from '../types';
import {HOSTED,trialId} from './runtime-mode';
import {track} from './hosted-usage';
import {librarySession} from "./library-session";
import {HOSTED_IMAGE_MAX_BYTES} from './pdf-data';
import { requestDeadline } from "./request-deadline";
import type { InquiryEvent, InquiryRequest, InquiryResponse, ThreadMessage } from "../types";

export class InquiryStreamError extends Error {constructor(message:string,public search?:SearchTrace){super(message);}}
export const PROGRESS_LABELS = { accepted: "请求已接受，正在处理", "search-started": "正在搜索资料", "search-completed": "已收到搜索结果，正在整理", "checking-sources": "正在核对引用文字" };
async function hostedCrop(entryId:string,cropId:string):Promise<string>{
  // Loaded lazily: a static import would create a module cycle through the library client.
  const {libraryBinary}=await import('./library-client');
  const blob=await (await libraryBinary(`/entries/${entryId}/resources/${cropId}`)).blob();
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(bytes.length>HOSTED_IMAGE_MAX_BYTES)throw new Error('所选区域图片过大，请缩小范围后重新框选。');
  let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(out);
}
export async function readInquiryStream(request: InquiryRequest, onEvent: (event: InquiryEvent) => void, signal?: AbortSignal, fetcher = fetch): Promise<void> {
  // Hosted requests carry the stored crop itself; the server has no reading library.
  const hostedImage=HOSTED&&request.image?await hostedCrop(request.image.entryId,request.image.cropId):undefined;
  const hostedBody=HOSTED?{...(hostedImage?{image:{data:hostedImage}}:{}),requestId:request.requestId,intent:request.intent==='why'?'explain':request.intent,quote:request.quote,context:request.context,question:request.question,history:request.history?.slice(-8).map(m=>({role:m.role,content:m.content})),...(request.scope?{scope:request.scope}:{}),...(request.round?{round:request.round}:{}),...(request.parentMessageId?{parentMessageId:request.parentMessageId}:{}),...(request.readingScope?{readingScope:request.readingScope}:{}),...(request.explanationMode==='local'||request.explanationMode==='web'?{explanationMode:request.explanationMode}:{})}:undefined;
  const budget = requestDeadline(30_000, signal);
  const resumed = () => { try { budget.check(); } catch { /* abort settles the active read */ } };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", resumed);
  if (typeof window !== "undefined") window.addEventListener("pageshow", resumed);
  try {
  const response = await budget.wait(fetcher(HOSTED?"/api/hosted/inquiry/stream":"/api/inquiries/stream", { method: "POST", headers: { "Content-Type": "application/json", ...(HOSTED?{"X-Trial-Id":trialId()}:{}), ...(!HOSTED && request.image ? {"X-Got-It-Session":await budget.wait(librarySession())} : {}) }, body: JSON.stringify(hostedBody??request), signal: budget.signal }));
  if (!response.ok) {
    let detail = "";
    try { const body = await budget.wait(response.json()); if (typeof body.error === "string") detail = body.error.slice(0, 300); } catch { /* Non-JSON failures use the HTTP status. */ }
    throw new Error(detail || `请求失败（HTTP ${response.status}），请重试。`);
  }
  if (!response.body) throw new Error("响应没有内容，请重试。");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", sequence = 0, complete = false;
  const line = (input: string) => {
    if (!input.trim() || complete) return;
    const e = JSON.parse(input) as InquiryEvent;
    if (e.requestId !== request.requestId || !Number.isSafeInteger(e.sequence) || e.sequence <= sequence) return;
    budget.check();
    sequence = e.sequence;
    if (e.type === "progress" && e.progress === "accepted") {
      budget.reset(typeof e.deadlineAt === "number" && Number.isFinite(e.deadlineAt) ? e.deadlineAt + 1000 : Date.now() + (request.operation === "verify" || request.intent === "verify" ? 241_000 : 121_000));
    }
    if (e.type === "error") {
      const search=HOSTED?copySearch(e.response?.search):undefined;
      if(search?.status==='failed')track('search-failed');
      throw search?new InquiryStreamError(e.error||'请求中断，请重试。',search):new Error(e.error||'请求中断，请重试。');
    }
    if (!["answer-delta", "progress", "preliminary", "source-update", "complete"].includes(e.type)) return;
    if (e.type === "complete" && !e.response) throw new Error("完成事件缺少结果。");
    if (e.type === "answer-delta" && typeof e.delta !== "string") throw new Error("正文增量格式错误。");
    complete = e.type === "complete";
    if(e.progress==='search-completed')track('search-complete');
    if(e.type==='complete'){
      track('answer-complete');
      if(request.intent==='verify')track('verify-complete');
      if(e.response?.sources.some(source=>source.retrievalStatus==='matched'))track('source-check-complete');
      if(e.response?.sources.some(source=>source.retrievalStatus&&source.retrievalStatus!=='matched'))track('source-check-failed');
    }
    onEvent(e);
  };
  try {
    while (true) {
      const { done, value } = await budget.wait(reader.read());
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 512 * 1024) throw new Error("响应超过读取限制。");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      if (complete) break;
      if (done) { if (buffer.trim()) line(buffer); break; }
    }
    if (!complete) throw new Error("连接已中断，本轮未完成；已收到的内容已保留。");
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  } catch (error) {
    if (budget.signal.aborted) throw budget.signal.reason;
    throw error;
  } finally {
    budget.dispose();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", resumed);
    if (typeof window !== "undefined") window.removeEventListener("pageshow", resumed);
  }
}
export function responseMessage(id: string, request: InquiryRequest, response: InquiryResponse, complete: boolean): ThreadMessage {
  return { id, role: "assistant", createdAt: new Date().toISOString(), content: response.answer, sources: response.sources, search: response.search,
    evidenceStatus: response.evidenceStatus, verification: response.verification, timings: response.timings,
    providerId: response.providerId, providerName: response.providerName, mode: response.mode, model: response.model, modelConfig: response.modelConfig ?? request.modelConfig,
    requestId: request.requestId, completion: complete ? "complete" : "provisional", operation: request.operation, explanationMode: request.explanationMode, scope: request.scope, round: request.round, parentMessageId: request.parentMessageId };
}
export function interruptMessage(message: ThreadMessage): ThreadMessage {
  if (message.completion !== "provisional" && message.verification?.completion !== "provisional") return message;
  return { ...message, completion: "interrupted", evidenceStatus: message.verification ? "partial" : message.evidenceStatus,
    verification: message.verification ? { ...message.verification, completion: "interrupted", verdict: "incomplete", summary: "本轮已中断，以下为尚未完成核对的结果。", readingAdvice: "不要把暂定结果当作确认结论；可重试本轮。" } : undefined };
}

export interface InquiryAdapter {read:typeof readInquiryStream}
export const inquiryAdapter:InquiryAdapter={read:readInquiryStream};
