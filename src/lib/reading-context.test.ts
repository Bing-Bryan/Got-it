import { expect, it } from 'vitest';
import { renderMarkdown } from './markdown';
import { readingContext } from './reading-context';
import { migrateHighlightAnchors } from './anchor-migration';
import { createInitialWorkspace } from '../sample';
import { applyInquiryHighlights, createAnchor } from './anchors';
import { stableHash } from '../sample';
import { sanitizeWorkspace } from './storage';
it('table requests include headers and row, bounded to relevant context',()=>{
 const el=document.createElement('article');el.innerHTML=renderMarkdown('# 市场\n\n| 产品 | 公司 | 定位 |\n| --- | --- | --- |\n| Talkie | MiniMax | 聊天与抽卡 |').html;
 const cell=[...el.querySelectorAll<HTMLElement>('td')].find(e=>e.textContent==='MiniMax')!;
 const anchor=createAnchor({documentId:'d',blockId:cell.dataset.blockId!,blockText:'MiniMax',start:0,end:7})!;
 expect(readingContext(el,anchor)).toContain('产品 | 公司 | 定位');expect(readingContext(el,anchor)).toContain('Talkie | MiniMax | 聊天与抽卡');
});
it('normalizes legacy highlighted offsets once without changing historical messages or merging repeated terms',()=>{
 const w=createInitialWorkspace();w.document.markdown='==CAGR== 与 ==CAGR== 的比较';
 const raw='==CAGR== 与 ==CAGR== 的比较',id=`block-0-${stableHash(`p:${raw}`).slice(0,7)}`;
 w.inquiries=[2,13].map((start,n)=>({id:String(n),intent:'explain',question:'旧问题',anchor:{documentId:w.document.id,blockId:id,quote:'CAGR',prefix:raw.slice(0,start),suffix:raw.slice(start+4),start,end:start+4,headingPath:[],matchStatus:'matched'},status:'ready',understanding:'',messages:[],createdAt:'',updatedAt:''}));
 // second word begins at 13 in the original source.
 const second=raw.lastIndexOf('CAGR');w.inquiries[1].anchor={...w.inquiries[1].anchor,start:second,end:second+4};
 const next=migrateHighlightAnchors(w);const root=document.createElement('div');root.innerHTML=renderMarkdown(w.document.markdown).html;
 for(const i of next.inquiries){expect(root.textContent!.slice(i.anchor.start,i.anchor.end)).toBe('CAGR');expect(i.anchor.textVersion).toBe(2);}
 expect(next.inquiries[0].anchor.start).not.toBe(next.inquiries[1].anchor.start);
 expect(migrateHighlightAnchors(sanitizeWorkspace(next))).toEqual(sanitizeWorkspace(next));
 const restored=migrateHighlightAnchors(sanitizeWorkspace(next));
 applyInquiryHighlights(root,restored.inquiries,'1');
 expect([...root.querySelectorAll('mark')].map(m=>m.textContent)).toEqual(['CAGR','CAGR']);
 expect(root.querySelector('[data-inquiry-id="1"]')?.className).toContain('is-active');
 expect(restored.document.markdown).toBe(raw);
});
it('renders source markers as plain text without altering code, old block ids or image notices',()=>{
 const html=renderMarkdown('==18–34岁==Z世代\n\n`==literal==`\n\n```text\n==block==\n```\n\n![市场图](media/image.png)').html;
 expect(html).not.toContain('source-highlight');expect(html).not.toContain('<mark');expect(html).not.toContain('==18–34岁==');expect(html).toContain('18–34岁Z世代');expect(html).toContain('<code>==literal==</code>');expect(html).toContain('==block==');expect(html).not.toContain('<img');expect(html).toContain('图片未随文档导入');
 expect(html).toContain(`block-0-${stableHash('p:==18–34岁==Z世代').slice(0,7)}`);
});

it("preserves self-contained raster images",()=>{expect(renderMarkdown("![inline](data:image/png;base64,AAAA)").html).toContain("<img");});
