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
  return group.filter(i => i.intent === intent).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function copyActiveTab(value: unknown, inquiries: Inquiry[]): Workspace["activeTab"] {
  if (!value || typeof value !== "object") return;
  const v = value as NonNullable<Workspace["activeTab"]>;
  if (["explain", "verify", "entity", "why"].includes(v.intent) && (v.anchorInquiryId === undefined || inquiries.some(i => i.id === v.anchorInquiryId))) return { anchorInquiryId: v.anchorInquiryId, intent: v.intent };
}

/** Category labels describe the existing user-confirmed progress, not evidence strength. */
export function inquiryCategoryStatus(inquiry: Inquiry): string {
  if (inquiry.intent === "verify" && (inquiry.status === "understood" || inquiry.status === "distilled")) return "已查找";
  if (inquiry.lastError) return "未完成";
  const action = inquiry.intent === "verify" ? "查找" : inquiry.intent === "entity" ? "介绍" : "解释";
  if (inquiry.status === "answering") return `${action}中`;
  if (isVerificationUnfinished(inquiry)) return "待查找";
  return `${inquiry.status === "understood" || inquiry.status === "distilled" ? "已" : "待"}${action}`;
}
