import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders common Markdown and assigns stable block metadata", () => {
    const result = renderMarkdown(`# 标题

正文包含 **重点**。

| 字段 | 值 |
| --- | --- |
| CAGR | 20% |
`);

    expect(result.html).toContain("<table>");
    expect(result.html).toContain("data-block-id");
    expect(result.outline).toEqual([
      expect.objectContaining({ text: "标题", level: 1 }),
    ]);
  });

  it("removes executable HTML while keeping safe content", () => {
    const result = renderMarkdown(
      `<img src="x" onerror="window.__bad = true"><script>window.__bad = true</script><p>安全内容</p>`,
    );

    expect(result.html).not.toContain("onerror");
    expect(result.html).not.toContain("<script");
    expect(result.html).toContain("安全内容");
  });

  it("adds safe attributes to external links", () => {
    const result = renderMarkdown(`[来源](https://example.com/source)`);

    expect(result.html).toContain('target="_blank"');
    expect(result.html).toContain('rel="noreferrer noopener"');
  });
});

describe("static web rendering", () => {
  const web = { version: 1 as const, originalUrl: "https://claude.dev/a", finalUrl: "https://claude.dev/a", extractorVersion: "v1", contentVersion: "a".repeat(64), media: [{ id: "diagram", kind: "svg" as const, status: "saved" as const, alt: '<img onerror="bad">', resourceId: "b".repeat(64), mime: "image/svg+xml" as const, bytes: 12 }], fragments: [{ fragment: "diagram", headingIndex: 1 }] };
  it("renders only opaque authorized image slots and blocks raw remote images and SVG", () => {
    const result = renderMarkdown('# Article\n\n![chart](got-it-media:diagram)\n\n![remote](https://remote.test/a.png)\n\n<img src="https://remote.test/b.png" srcset="https://remote.test/c.png 2x"><svg><text>raw chart</text></svg><video src="https://remote.test/a.mp4"></video>', web);
    const node = document.createElement("div"); node.innerHTML = result.html;
    expect(node.querySelectorAll("img")).toHaveLength(1);
    expect(node.querySelector("img")?.dataset.webMedia).toBe("diagram");
    expect(node.querySelector("img")?.getAttribute("src")).toBeNull();
    expect(node.querySelector("img")?.alt).toBe('<img onerror="bad">');
    expect(node.querySelector("svg,video,[src],[srcset],[onerror]")).toBeNull();
    expect(node.textContent).toContain("图片未获授权");
  });
  it("maps source fragments to stable local headings without changing body anchor ids", () => {
    const body = '# Article\n\nText\n\n## Diagram\n\n[jump](#diagram)';
    const result = renderMarkdown(body, web);
    expect(result.html).toContain(`href="#${result.outline[1].id}"`);
    expect(result.html.match(/data-block-id="[^"]+"/g)).toEqual(renderMarkdown(body).html.match(/data-block-id="[^"]+"/g));
  });
});
it('shows public X missing images in place with a safe user-opened link, consistently in translated output',async()=>{const {webWorkspace}=await import('../test-support/web');const w=webWorkspace();if(w.document.kind!=='web')throw Error();const m=w.document.web.media.find(m=>m.status!=='saved')!;m.sourceUrl='https://pbs.twimg.com/media/Sample.jpg?name=orig';const md=`# Title\n\nVisible original body.\n\n![Missing](got-it-media:${m.id})`;const original=renderMarkdown(md,w.document.web),dom=document.createElement('div');dom.innerHTML=original.html;expect(dom.querySelector('.image-unavailable')?.textContent).toContain('图片未保存到本机');const link=dom.querySelector('.image-unavailable a')!;expect(link.getAttribute('href')).toBe(m.sourceUrl);expect(link.getAttribute('rel')?.split(' ').sort()).toEqual(['noopener','noreferrer']);expect(dom.querySelector('img[src]')).toBeNull();const {buildTranslationSource,renderTranslatedHtml,TRANSLATION_PLACEHOLDER}=await import('./web-translation');const source=buildTranslationSource(md,w.document.web),values=Object.fromEntries(source.units.map(u=>[u.id,'中文正文 '+(u.text.match(TRANSLATION_PLACEHOLDER)??[]).join(' ')]));expect(JSON.stringify(source.units)).not.toContain('pbs.twimg.com');const translated=renderTranslatedHtml(source,values);expect(translated).toContain('图片未保存到本机');expect(translated).toContain(m.sourceUrl);expect(translated).not.toContain('<img');expect(source.blocks.map(b=>b.id)).toEqual([...dom.querySelectorAll('[data-block-id]')].map(n=>(n as HTMLElement).dataset.blockId));});
