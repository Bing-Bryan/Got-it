import { expect, it } from 'vitest';
import { readingFixture } from '../test-support/recovery-fixture';
import { sanitizeWorkspace, restoreWorkspace, saveWorkspace, loadWorkspace } from './storage';
import { workspaceToReadingDocument, parseReadingDocument } from './reading-document';
import { inquiryCategoryStatus } from './inquiry-tabs';

it('retains source explanation, uncertain evidence and anchor across saves and Markdown backup', () => {
 const workspace=readingFixture();const i=workspace.inquiries[0];i.intent='verify';i.status='understood';
 Object.assign(i.messages[0],{search:{status:'unknown',completedSearches:0,failedSearches:0},verification:{verdict:'partial',summary:'只有转述资料。',reason:'2023年样本不能对应2025年的行业结论。',readingAdvice:'原始出处未确认。',claims:[],round:1,scope:'initial',completion:'complete'}});
 const before=structuredClone(workspace);const restored=restoreWorkspace(sanitizeWorkspace(workspace))!;
 expect(restored.inquiries).toEqual(before.inquiries);expect(inquiryCategoryStatus(restored.inquiries[0])).toBe('有参考资料');
 const parsed=parseReadingDocument(workspaceToReadingDocument(restored));
 expect(parsed).toBeTruthy();
 // The parser preserves the complete sidecar rather than reconstructing a verdict from text.
 expect(JSON.stringify(parsed)).toContain('2023年样本不能对应2025年的行业结论。');
 expect(JSON.stringify(parsed)).toContain('"status":"unknown"');
 const store=new Map<string,string>();const storage={getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value)},removeItem:(key:string)=>{store.delete(key)}};
 const failed=saveWorkspace(workspace,{...storage,setItem(){throw new Error('受控写入失败')}});
 expect(failed.ok).toBe(false);expect(workspace).toEqual(before);
 expect(saveWorkspace(workspace,storage).ok).toBe(true);expect(loadWorkspace(storage)?.inquiries).toEqual(before.inquiries);
});
