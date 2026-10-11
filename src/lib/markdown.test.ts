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
