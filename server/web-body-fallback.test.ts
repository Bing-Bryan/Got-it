import {expect,it} from 'vitest';
import {parse} from 'parse5';
import {genericArticle,visibleText} from './web-body';

// Synthetic fixtures modelled on Chinese media pages without <article>/<main> (see
// artifacts/hosted-web-trial/web-coverage.md); the prose is invented for the tests.
const para=(n:number)=>`<p>这是第${n}段用于测试的正文内容，它足够长，能够通过正文段落的最小长度要求，并且不包含任何链接。为了让整篇文章达到总字数门槛，这里再补充一句同样只用于测试的说明文字。</p>`;
const page=(body:string)=>parse(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`);

it('falls back to the deepest container holding the article prose and takes the preceding h1 as title',()=>{
  const root=page(`<div class="header"><a href="/">首页</a></div><div class="wrap"><h1>测试文章标题</h1><div class="info">作者与时间</div>
    <div class="g-articl-text">${[1,2,3,4,5].map(para).join('')}</div>
    <div class="related"><p><a href="/a">相关推荐链接一，标题足够长以至于超过四十个字符的最小长度要求而被统计在内</a></p></div></div>`);
  const {body,heading}=genericArticle(root);
  expect('attrs'in body&&body.attrs.find(a=>a.name==='class')?.value).toBe('g-articl-text');
  expect(visibleText(heading)).toBe('测试文章标题');
});

it('rejects two similar, non-nested prose regions instead of guessing',()=>{
  const root=page(`<h1>标题</h1><div class="a">${[1,2,3,4].map(para).join('')}</div><div class="b">${[5,6,7,8].map(para).join('')}</div>`);
  expect(()=>genericArticle(root)).toThrow('多个相近的正文区域');
});

it('does not treat a link-heavy list as article prose',()=>{
  const links=[1,2,3,4,5].map(n=>`<p><a href="/${n}">第${n}条推荐链接，链接文字也足够长，用来模拟门户网站常见的推荐列表与导航区块</a></p>`).join('');
  expect(()=>genericArticle(page(`<h1>标题</h1><div class="list">${links}</div>`))).toThrow(/正文/);
});

it('still uses semantic containers first when they qualify',()=>{
  const root=page(`<div class="g-articl-text">${[1,2].map(para).join('')}</div><article><h1>语义标题</h1>${[3,4,5,6].map(para).join('')}</article>`);
  const {article,heading}=genericArticle(root);
  expect('tagName'in article&&article.tagName).toBe('article');expect(visibleText(heading)).toBe('语义标题');
});

it('keeps rejecting pages with prose only as bare text and line breaks',()=>{
  const root=page(`<table><tr><td><font>第一行很长的文字内容，用来模拟没有段落标签的老式网页排版方式。<br><br>第二行同样很长的文字内容，依然没有任何段落标签包裹。</font></td></tr></table>`);
  expect(()=>genericArticle(root)).toThrow();
});
