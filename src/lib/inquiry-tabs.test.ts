import {expect,it} from 'vitest';
import {readingFixture} from '../test-support/recovery-fixture';
import {inquiryCategoryStatus} from './inquiry-tabs';
import type {Inquiry, ThreadMessage} from '../types';
it.each([
 ['explain','ready',{},'已有解释'],['entity','understood',{},'已有解释'],['why','distilled',{},'已有解释'],
 ['explain','answering',{},'解释中'],['verify','answering',{},'查找中'],['entity','answering',{},'解释中'],
 ['explain','understood',{completion:'interrupted'},'未完成'],['explain','ready',{completion:'provisional'},'未完成'],
 ['explain','ready',{completion:undefined},'历史回答'],['explain','ready',{mode:'demo'},'示例回答'],
 ['explain','understood',{search:{status:'failed',completedSearches:0,failedSearches:1}},'未完成'],
 ['explain','ready',{content:''},'待解释'],['verify','ready',{content:''},'待查找'],['entity','ready',{content:''},'待解释'],
] as [Inquiry['intent'],Inquiry['status'],Partial<ThreadMessage>,string][])('derives %s/%s result presentation', (intent,status,patch,label)=>{
 const i=readingFixture().inquiries[0];i.intent=intent;i.status=status;Object.assign(i.messages[0],patch);const before=structuredClone(i);
 expect(inquiryCategoryStatus(i)).toBe(label);expect(i).toEqual(before);
});
it.each(['executed','failed','unknown','not-executed',undefined] as const)('keeps source execution %s independent from old understood state',status=>{
 const i=readingFixture().inquiries[0];i.intent='verify';i.status='understood';
 i.messages[0].verification={completion:'complete',verdict:'insufficient',summary:'证据不足',reason:'缺少依据',readingAdvice:'保留限制',claims:[],round:1,scope:'initial'};
 i.messages[0].search=status?{status,completedSearches:status==='executed'?1:0,failedSearches:0}:undefined;
 expect(inquiryCategoryStatus(i)).toBe(status==='executed'?'已有结果':'未完成');
 i.lastError='失败';expect(inquiryCategoryStatus(i)).toBe('未完成');
});
