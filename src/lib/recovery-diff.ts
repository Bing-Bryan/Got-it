import type { Inquiry, Workspace } from '../types';
import { canonical, inquiryContent } from './reading-recovery';
export interface RecoveryDifference { id: string; before?: Inquiry; after?: Inquiry; kind: 'added' | 'removed' | 'changed' | 'same'; fields: string[] }
export function recoveryDiff(before: Workspace, after: Workspace) {
  const old = new Map(before.inquiries.map(i => [i.id, i]));
  const next = new Map(after.inquiries.map(i => [i.id, i]));
  const rows: RecoveryDifference[] = [...new Set([...next.keys(), ...old.keys()])].map(id => {
    const a = old.get(id), b = next.get(id);
    if (!a || !b) return {id, before:a, after:b, kind:a ? 'removed' : 'added', fields:[]};
    if (inquiryContent(a) === inquiryContent(b)) return {id, before:a, after:b, kind:'same', fields:[]};
    const fields: string[] = [];
    if (a.question !== b.question || a.intent !== b.intent) fields.push('问题或用途变化');
    if (canonical(a.messages.map(m=>({role:m.role,content:m.content}))) !== canonical(b.messages.map(m=>({role:m.role,content:m.content})))) fields.push('回答或对话变化');
    if (canonical(a.messages.map(m=>({sources:m.sources,verification:m.verification,search:m.search,evidenceStatus:m.evidenceStatus}))) !== canonical(b.messages.map(m=>({sources:m.sources,verification:m.verification,search:m.search,evidenceStatus:m.evidenceStatus})))) fields.push('来源或核查变化');
    if (a.status !== b.status || a.understanding !== b.understanding) fields.push('理解或处理状态变化');
    if (canonical(a.anchor) !== canonical(b.anchor)) fields.push('原文位置变化');
    return {id, before:a, after:b, kind:'changed', fields:fields.length ? fields : ['其他记录信息变化']};
  });
  const content = (w:Workspace) => w.document.kind === 'pdf' ? {kind:'pdf',pdf:w.document.pdf} : {kind:'markdown',text:w.document.markdown};
  return {rows, originalChanged:canonical(content(before)) !== canonical(content(after)), counts:{added:rows.filter(r=>r.kind==='added').length,removed:rows.filter(r=>r.kind==='removed').length,changed:rows.filter(r=>r.kind==='changed').length,same:rows.filter(r=>r.kind==='same').length}};
}
export function hasRecoveryDifference(before:Workspace,after:Workspace) {
  const d=recoveryDiff(before,after);
  return d.originalChanged || !!(d.counts.added+d.counts.removed+d.counts.changed);
}
export function describeRecoveryDifference(before:Workspace,after:Workspace) {
  const d=recoveryDiff(before,after), {added,removed,changed}=d.counts;
  const parts:string[]=[];
  if (!removed && !changed && added) parts.push(`当前保存的记录包含之前的全部 ${before.inquiries.length} 条知识贴，另外增加了 ${added} 条`);
  else {
    if (added) parts.push(`当前记录多了 ${added} 条知识贴`);
    if (removed) parts.push(`之前记录中有 ${removed} 条知识贴未包含在当前记录里`);
    if (changed) parts.push(`有 ${changed} 条知识贴内容或状态不同`);
    if (!added&&!removed&&!changed) parts.push('两份记录的知识贴相同');
  }
  return `${parts.join('；')}。${d.originalChanged?'两份文章正文不同，回答可能对应不同段落。':'原文没有变化。'}`;
}
