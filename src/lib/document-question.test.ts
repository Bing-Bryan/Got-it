import { expect, it, vi } from 'vitest';
import { createInitialWorkspace } from '../sample';
import { documentAnchor, documentQuestionContext, markdownSections, DOCUMENT_CONTEXT_LIMIT } from './document-question';
import { restoreWorkspace } from './storage';
import { workspaceToReadingDocument, parseReadingDocument } from './reading-document';
import { applyInquiryHighlights } from './anchors';
import { sameAnchor } from './inquiry-tabs';
it('keeps short text complete and selects relevant late sections of long text within budget', () => {
 const short=[{label:'定位',text:'本产品帮助阅读者理解文章。'},{label:'区别',text:'比较知识与阅读工具。'}];
 const all=documentQuestionContext(short,'区别'); expect(all.context).toContain(short[1].text);expect(all.notice).toBe('');
 const long=Array.from({length:40},(_,i)=>({label:`章节 ${i}`,text:i===39?'竞争定位：采用本地阅读。'.repeat(70):'普通背景信息。'.repeat(160)}));
 const selected=documentQuestionContext(long,'竞争定位有什么区别？');expect(selected.context.length).toBeLessThanOrEqual(DOCUMENT_CONTEXT_LIMIT);expect(selected.context).toContain('竞争定位：');expect(selected.context).toContain('章节 0');expect(selected.notice).toContain('相关片段');
 expect(()=>documentQuestionContext([], '问题')).toThrow('没有');
});
it('reads rendered Markdown without duplicating highlighted text',()=>{
 const article=document.createElement('article');article.innerHTML='<h2>定位</h2><p>产品<mark>阅读</mark>工具</p>';
 expect(markdownSections(article)).toEqual([{label:'定位',text:'定位'},{label:'定位',text:'产品阅读工具'}]);
});
it('roundtrips document questions and coverage notices without highlights or selected-anchor grouping',()=>{
 const w=createInitialWorkspace(),a=documentAnchor(w.document);
 w.inquiries=[{id:'doc-question',intent:'ask',question:'整体定位？',anchor:a,status:'ready',messages:[{id:'answer',role:'assistant',content:'答案',contextNotice:'基于相关片段',createdAt:'2026'}],understanding:'',createdAt:'2026',updatedAt:'2026'}];
 const restored=parseReadingDocument(workspaceToReadingDocument(w));expect(restored.inquiries[0].anchor).toEqual(a);expect(restored.inquiries[0].messages[0].contextNotice).toBe('基于相关片段');
 const article=document.createElement('article');article.innerHTML='<p>全文</p>';const missing=vi.fn();applyInquiryHighlights(article,w.inquiries,null,missing);expect(missing).not.toHaveBeenCalled();expect(article.querySelector('mark')).toBeNull();
 expect(sameAnchor(a,{...a,scope:undefined})).toBe(false);expect(sameAnchor(a,{...a,documentId:'other'})).toBe(false);
 expect(restoreWorkspace({...w,inquiries:[{...w.inquiries[0],intent:'explain'}]})).toBeNull();
 expect(restoreWorkspace({...w,inquiries:[{...w.inquiries[0],anchor:{...a,start:1}}]})).toBeNull();
});
it('exports whole-document questions without fake source offsets',async()=>{
 const {workspaceToMarkdown}=await import('./export');const w=createInitialWorkspace();w.inquiries=[{id:'d',intent:'ask',question:'整体定位？',anchor:documentAnchor(w.document),status:'ready',messages:[{id:'a',role:'assistant',content:'答案',contextNotice:'仅参考文字层',createdAt:'2026'}],understanding:'',createdAt:'2026',updatedAt:'2026'}];
 const text=workspaceToMarkdown(w);expect(text).toContain('提问范围：全文');expect(text).toContain('仅参考文字层');expect(text).not.toContain('原文位置：0');expect(text).not.toContain('原文回链');
});
