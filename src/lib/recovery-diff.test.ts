import {it,expect} from 'vitest';
import {readingFixture} from '../test-support/recovery-fixture';
import {recoveryDiff} from './recovery-diff';
it('counts only meaningful differences and identifies changed fields',()=>{
 const a=readingFixture(), b=structuredClone(a);b.inquiries[0].updatedAt='later';
 expect(recoveryDiff(a,b).counts.same).toBe(1);
 b.inquiries[0].messages[0].content='另一份回答';b.inquiries[0].messages[0].evidenceStatus='supported';b.inquiries[0].understanding='已理解';
 b.inquiries.push({...structuredClone(b.inquiries[0]),id:'new'});
 a.inquiries.push({...structuredClone(a.inquiries[0]),id:'old'});
 const d=recoveryDiff(a,b);expect(d.counts).toEqual({added:1,removed:1,changed:1,same:0});
 expect(d.rows[0].fields).toEqual(['回答或对话变化','来源或核查变化','理解或处理状态变化']);
 expect(d.originalChanged).toBe(false);b.document.markdown='改变原文';expect(recoveryDiff(a,b).originalChanged).toBe(true);
});
it('describes inclusion, exclusive content, changed answers and different originals plainly',async()=>{
 const {describeRecoveryDifference}=await import('./recovery-diff');
 const before=readingFixture(),after=structuredClone(before);after.inquiries.push({...structuredClone(after.inquiries[0]),id:'new'});
 expect(describeRecoveryDifference(before,after)).toBe('当前保存的记录包含之前的全部 1 条知识贴，另外增加了 1 条。原文没有变化。');
 before.inquiries.push({...structuredClone(before.inquiries[0]),id:'old'});
 expect(describeRecoveryDifference(before,after)).toContain('之前记录中有 1 条知识贴未包含在当前记录里');
 after.inquiries[0].messages[0].content='改动回答';after.document.markdown='不同原文';
 expect(describeRecoveryDifference(before,after)).toContain('有 1 条知识贴内容或状态不同');expect(describeRecoveryDifference(before,after)).toContain('两份文章正文不同');
});
