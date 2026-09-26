import type { InquiryEvent, InquiryRequest, InquiryResponse, ThreadMessage } from "../types";

export const PROGRESS_LABELS = { accepted: "请求已接受，正在处理", "search-started": "正在搜索资料", "search-completed": "已收到搜索结果，正在整理", "checking-sources": "正在核对引用文字" };
export async function readInquiryStream(request: InquiryRequest, onEvent: (event: InquiryEvent) => void, signal?: AbortSignal, fetcher = fetch): Promise<void> {
  const response = await fetcher("/api/inquiries/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal });
  if (!response.ok) {
    let detail = "";
    try { const body = await response.json(); if (typeof body.error === "string") detail = body.error.slice(0, 300); } catch { /* Non-JSON failures use the HTTP status. */ }
    throw new Error(detail || `请求失败（HTTP ${response.status}），请重试。`);
  }
  if (!response.body) throw new Error("响应没有内容，请重试。");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", sequence = 0, complete = false;
  const line = (input: string) => {
    if (!input.trim() || complete) return;
    const e = JSON.parse(input) as InquiryEvent;
    if (e.requestId !== request.requestId || !Number.isSafeInteger(e.sequence) || e.sequence <= sequence) return;
    sequence = e.sequence;
    if (e.type === "error") throw new Error(e.error || "请求中断，请重试。");
    if (!["answer-delta", "progress", "preliminary", "source-update", "complete"].includes(e.type)) return;
    if (e.type === "complete" && !e.response) throw new Error("完成事件缺少结果。");
    if (e.type === "answer-delta" && typeof e.delta !== "string") throw new Error("正文增量格式错误。");
    complete = e.type === "complete";
    onEvent(e);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 512 * 1024) throw new Error("响应超过读取限制。");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      if (done) { if (buffer.trim()) line(buffer); break; }
    }
    if (!complete) throw new Error("连接已中断，本轮未完成；已收到的内容已保留。");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export function responseMessage(id: string, request: InquiryRequest, response: InquiryResponse, complete: boolean): ThreadMessage {
  return { id, role: "assistant", createdAt: new Date().toISOString(), content: response.answer, sources: response.sources, search: response.search,
    evidenceStatus: response.evidenceStatus, verification: response.verification, timings: response.timings,
    providerId: response.providerId, providerName: response.providerName, mode: response.mode, model: response.model, modelConfig: response.modelConfig ?? request.modelConfig,
    requestId: request.requestId, completion: complete ? "complete" : "provisional", operation: request.operation, scope: request.scope, round: request.round, parentMessageId: request.parentMessageId };
}
export function interruptMessage(message: ThreadMessage): ThreadMessage {
  if (message.completion !== "provisional" && message.verification?.completion !== "provisional") return message;
  return { ...message, completion: "interrupted", evidenceStatus: message.verification ? "partial" : message.evidenceStatus,
    verification: message.verification ? { ...message.verification, completion: "interrupted", verdict: "incomplete", summary: "本轮已中断，以下为尚未完成核对的结果。", readingAdvice: "不要把暂定结果当作确认结论；可重试本轮。" } : undefined };
}
