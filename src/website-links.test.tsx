import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AssistantMessage } from './App';
import { sourceEvidence } from './lib/evidence';
import type { ThreadMessage } from './types';
const message:ThreadMessage={id:'m',role:'assistant',createdAt:'now',content:'介绍正文',operation:'entity',sources:[{id:'r',title:'第三方资料',url:'https://example.org/read',domain:'example.org',origin:'original'},{id:'o',title:'官方产品',url:'https://character.ai/',domain:'character.ai',websiteRole:'official'},{id:'bad',title:'坏链接',url:'javascript:alert(1)',domain:''}]};
it('shows safe website links with official first, never promotes original documents to official sites',()=>{
 const html=renderToStaticMarkup(<AssistantMessage message={message} entity/>);
 expect(html).not.toContain('查看证据与差异');expect(html).not.toContain('坏链接');expect(html).toContain('noopener noreferrer');expect(html.indexOf('官方产品')).toBeLessThan(html.indexOf('第三方资料'));expect((html.match(/<em>官网/g)??[]).length).toBe(1);
 expect(sourceEvidence(message.sources![1]).websiteRole).toBe('official');expect(sourceEvidence(message.sources![0]).websiteRole).toBeUndefined();
});
it('keeps evidence review for verification and no website block for explanation followups',()=>{
 expect(renderToStaticMarkup(<AssistantMessage message={{...message,operation:'verify'}} verification/>)).toContain('source-evidence-card');
 const html=renderToStaticMarkup(<AssistantMessage message={{...message,operation:'explain'}} entity/>);expect(html).not.toContain('相关网站');expect(html).not.toContain('查看证据与差异');
});
