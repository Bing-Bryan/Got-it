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
 ['explain','ready',{content:''},'待解释'],['verify','ready',{content:'',sources:[]},'查看查找记录'],['entity','ready',{content:''},'待解释'],
] as [Inquiry['intent'],Inquiry['status'],Partial<ThreadMessage>,string][])('derives %s/%s result presentation', (intent,status,patch,label)=>{
 const i=readingFixture().inquiries[0];i.intent=intent;i.status=status;Object.assign(i.messages[0],patch);const before=structuredClone(i);
 expect(inquiryCategoryStatus(i)).toBe(label);expect(i).toEqual(before);
});
it.each(['executed','failed','unknown','not-executed',undefined] as const)('does not confuse material availability with search execution %s',status=>{
 const i=readingFixture().inquiries[0];i.intent='verify';i.status='understood';
 i.messages[0].verification={completion:'complete',verdict:'insufficient',summary:'证据不足',reason:'缺少依据',readingAdvice:'保留限制',claims:[],round:1,scope:'initial'};
 i.messages[0].search=status?{status,completedSearches:status==='executed'?1:0,failedSearches:0}:undefined;
 const before=structuredClone(i);
 expect(inquiryCategoryStatus(i)).toBe(status==='failed'?'有参考资料 · 查找失败':'有参考资料');expect(i).toEqual(before);
 i.lastError='请求超时';expect(inquiryCategoryStatus(i)).toBe('有参考资料 · 查找失败');
 i.messages[0].completion='interrupted';expect(inquiryCategoryStatus(i)).toBe('有参考资料 · 已中断');
 i.messages[0].sources=[];expect(inquiryCategoryStatus(i)).toBe('已中断');
});
it('does not advertise unsafe URLs, absent results, or samples as reference material',()=>{
 const i=readingFixture().inquiries[0];i.intent='verify';
 i.messages[0].sources![0].url='javascript:alert(1)';expect(inquiryCategoryStatus(i)).toBe('查看查找记录');
 i.messages[0].mode='demo';expect(inquiryCategoryStatus(i)).toBe('示例回答');
 i.messages=[];expect(inquiryCategoryStatus(i)).toBe('查看查找记录');
 i.lastError='服务不可用';expect(inquiryCategoryStatus(i)).toBe('查找失败');
});

it.each(['executed','unknown','not-executed'] as const)('only reports not-found after a completed observed search: %s',status=>{
 const i=readingFixture().inquiries[0];i.intent='verify';const m=i.messages[0];m.sources=[];
 m.search={status,completedSearches:status==='executed'?1:0,failedSearches:0};
 m.verification={verdict:'insufficient',summary:'本次未定位到对应资料',reason:'无法确认出处',readingAdvice:'',claims:[],round:1,scope:'initial',completion:'complete'};
 expect(inquiryCategoryStatus(i)).toBe(status==='executed'?'暂未找到参考资料':'查看查找记录');
 m.completion='provisional';expect(inquiryCategoryStatus(i)).toBe('查看查找记录');
});
it('keeps an unverified excerpt as reference material without claiming verified evidence',()=>{
 const i=readingFixture().inquiries[0];i.intent='verify';
 Object.assign(i.messages[0].sources![0],{excerptKind:'unverified',retrievalStatus:'unavailable',excerpt:'尚未核对的文字'});
 expect(inquiryCategoryStatus(i)).toBe('有参考资料');
});
