import type { Anchor, Inquiry, InquiryIntent, Workspace } from "../types";
import { isVerificationUnfinished } from "./learning";
export function sameAnchor(a: Anchor, b: Anchor): boolean {
  if (!!a.pdf !== !!b.pdf) return false;
  if (a.pdf && b.pdf && (a.pdf.fileHash !== b.pdf.fileHash || a.pdf.page !== b.pdf.page || a.pdf.kind !== b.pdf.kind || JSON.stringify(a.pdf.rects)!==JSON.stringify(b.pdf.rects))) return false;
  return a.matchStatus === "matched" && b.matchStatus === "matched" && a.documentId === b.documentId && a.blockId === b.blockId && a.start === b.start && a.end === b.end && a.quote === b.quote;
}
export function anchorGroup(inquiries: Inquiry[], representative: Inquiry): Inquiry[] {
  return inquiries.filter(i => i.id === representative.id || sameAnchor(i.anchor, representative.anchor));
}
export function intentHistory(group: Inquiry[], intent: InquiryIntent): Inquiry[] {
  return group.filter(i => categoryIntent(i.intent) === categoryIntent(intent)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function copyActiveTab(value: unknown, inquiries: Inquiry[]): Workspace["activeTab"] {
  if (!value || typeof value !== "object") return;
  const v = value as NonNullable<Workspace["activeTab"]>;
  if (["explain", "verify", "entity", "why", "ask"].includes(v.intent) && (v.anchorInquiryId === undefined || inquiries.some(i => i.id === v.anchorInquiryId))) return { anchorInquiryId: v.anchorInquiryId, intent: v.intent };
}

/** Presentation only: learning fields never determine whether a reply completed. */
export function inquiryCategoryStatus(inquiry: Inquiry): string {
  const action = inquiry.intent === "verify" ? "查找" : inquiry.intent === "ask" ? "回答" : "解释";
  const latest = [...inquiry.messages].reverse().find(m => m.role === 'assistant');
  if (inquiry.status === 'answering') return `${action}中`;
  if (inquiry.lastError || latest?.search?.status === 'failed' || latest?.completion === 'interrupted' || latest?.completion === 'provisional') return '未完成';
  if (!latest?.content.trim()) return `待${action}`;
  if (latest.mode === 'demo') return '示例回答';
  if (inquiry.intent === 'verify') {
    if (latest.search?.status !== 'executed' || isVerificationUnfinished(inquiry)) return '未完成';
    return '已有结果';
  }
  if (latest.completion !== 'complete') return '历史回答';
  return `已有${action}`;
}

/** Keep legacy identities intact while presenting introductions with explanations. */
export function categoryIntent(intent: InquiryIntent): InquiryIntent { return intent === 'entity' ? 'explain' : intent; }
export function copyVisitedIds(value: unknown, inquiries: Inquiry[]): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set(inquiries.map(i => i.id));
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && ids.has(id)))];
}
export function rememberInquiry(workspace: Workspace, id: string): string[] {
  return [...copyVisitedIds(workspace.visitedInquiryIds, workspace.inquiries).filter(v => v !== id), id];
}
export function preferredInquiry(workspace: Workspace, id: string): Inquiry | undefined {
  const representative = workspace.inquiries.find(i => i.id === id);
  if (!representative) return;
  const group = anchorGroup(workspace.inquiries, representative);
  for (const visited of [...(workspace.visitedInquiryIds ?? [])].reverse()) {
    const match = group.find(i => i.id === visited);
    if (match) return match;
  }
  return group.find(i => i.intent === 'explain') ?? group.find(i => i.intent === 'entity') ?? representative;
}
