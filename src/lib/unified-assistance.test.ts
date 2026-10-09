import { expect, it } from 'vitest';
import { readingFixture } from '../test-support/recovery-fixture';
import { preferredInquiry, rememberInquiry, intentHistory } from './inquiry-tabs';
import { restoreWorkspace, sanitizeWorkspace } from './storage';
import { workspaceToReadingDocument, parseReadingDocument } from './reading-document-core';
import { questionContext } from './reading-context';
import type { Inquiry } from '../types';

function fixture() {
 const w=readingFixture(), base=w.inquiries[0];
 w.inquiries=[{...base,id:'verify',intent:'verify'},{...base,id:'ask1',intent:'ask',question:'价格包含什么？'},{...base,id:'explain',intent:'explain'},{...base,id:'ask2',intent:'ask',question:'和另一产品有什么不同？'}, {...base,id:'legacy',intent:'entity'}];
 return w;
}
it('defaults to explanation regardless of representative or array order, then remembers exact result per anchor',()=>{
 const w=fixture();expect(preferredInquiry(w,'verify')?.id).toBe('explain');expect(preferredInquiry(w,'ask1')?.id).toBe('explain');
 w.visitedInquiryIds=rememberInquiry(w,'ask2');expect(preferredInquiry(w,'verify')?.id).toBe('ask2');
 const other:Inquiry={...w.inquiries[0],id:'other',anchor:{...w.inquiries[0].anchor,start:999,end:1003}};w.inquiries.push(other);
 w.visitedInquiryIds=rememberInquiry(w,'other');expect(preferredInquiry(w,'verify')?.id).toBe('ask2');expect(preferredInquiry(w,'other')?.id).toBe('other');
 w.inquiries=w.inquiries.filter(i=>i.id!=='ask2');expect(preferredInquiry(w,'ask1')?.id).toBe('explain');
});
it('falls back to legacy introduction or existing source without fabricating a result',()=>{
 const w=fixture();w.inquiries=w.inquiries.filter(i=>i.intent!=='explain');expect(preferredInquiry(w,'verify')?.id).toBe('legacy');
 w.inquiries=w.inquiries.filter(i=>i.intent!=='entity');expect(preferredInquiry(w,'verify')?.id).toBe('verify');
 expect(intentHistory(fixture().inquiries,'explain').map(i=>i.id)).toEqual(['explain','legacy']);
});
it('round trips concrete questions, safe context, old identities and view memory through local and portable saves',()=>{
 const w=fixture();w.visitedInquiryIds=['bad','verify','ask1','verify'];
 w.inquiries[1].contextHistory=[{role:'assistant',content:'之前的有限上下文', secret:'should-never-save'} as never];
 w.inquiries[1].messages=[{id:'a',role:'assistant',content:'部分回答',createdAt:'2026',operation:'ask',explanationMode:'auto',completion:'provisional'}];
 const loaded=parseReadingDocument(workspaceToReadingDocument(w));
 expect(loaded.inquiries[1]).toMatchObject({intent:'ask',question:'价格包含什么？',contextHistory:[{role:'assistant',content:'之前的有限上下文'}]});
 expect(loaded.inquiries[1].messages[0]).toMatchObject({operation:'ask',explanationMode:'auto',completion:'interrupted'});
 expect(loaded.visitedInquiryIds).toEqual(['verify','ask1']);expect(JSON.stringify(loaded)).not.toContain('should-never-save');
 expect(restoreWorkspace(sanitizeWorkspace(w))?.inquiries.at(-1)?.intent).toBe('entity');
});
it('adds only bounded local comparison passages and retains row headers',()=>{
 const el=document.createElement('article');el.innerHTML='<table><thead><tr><th>产品</th><th>价格</th></tr></thead><tbody><tr><td data-block-id="a">ElliQ</td><td>$249</td></tr><tr><td data-block-id="b">LOVOT</td><td>月服务费</td></tr></tbody></table><p data-block-id="c">不相关秘密段落</p>';
 const anchor={...fixture().inquiries[0].anchor,blockId:'a',quote:'ElliQ',start:0,end:5};
 const context=questionContext(el,anchor,'和 LOVOT 有什么不同？');expect(context).toContain('表头：产品 | 价格');expect(context).toContain('LOVOT');expect(context).not.toContain('不相关秘密');expect(context.length).toBeLessThanOrEqual(5600);
});
