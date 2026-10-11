import { createInitialWorkspace } from "../sample";
import type { WebDocumentData } from "../lib/web-data";
export function webWorkspace() {
  const w = createInitialWorkspace();
  const web: WebDocumentData = { version: 1, originalUrl: "https://claude.dev/blog/article/#chart", finalUrl: "https://claude.dev/blog/article/", extractorVersion: "claude-static-v1", contentVersion: "a".repeat(64),
    media: [{ id: "image-one", kind: "image", status: "saved", alt: "Architecture", resourceId: "b".repeat(64), mime: "image/png", bytes: 123, width: 640, height: 360 }, { id: "chart-two", kind: "svg", status: "missing", alt: "Chart", reason: "获取失败" }], fragments: [{ fragment: "chart", headingIndex: 1 }] };
  w.document = { kind: "web", id: "web-doc", filename: "静态文章", markdown: "# 静态文章\n\n正文。\n\n![Architecture](got-it-media:image-one)\n\n## 图表\n\n![Chart](got-it-media:chart-two)", web, importedAt: "2026-10-10T00:00:00Z", isDemo: false, contentHash: web.contentVersion };
  w.inquiries = []; w.activeInquiryId = null; w.activeTab = undefined;
  return w;
}
