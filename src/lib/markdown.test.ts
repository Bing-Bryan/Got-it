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
