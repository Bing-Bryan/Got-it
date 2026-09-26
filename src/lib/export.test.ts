import { describe, expect, it } from "vitest";
import type { Workspace } from "../types";
import { workspaceToJson, workspaceToMarkdown } from "./export";
import { canCompleteInquiry } from "./learning";

const workspace: Workspace = {
  schemaVersion: 1,
  document: {
    id: "doc-1",
    filename: "report.md",
    markdown: "CAGR 是复合年增长率。",
    importedAt: "2026-09-21T00:00:00.000Z",
    contentHash: "hash",
    isDemo: false,
  },
  inquiries: [
    {
      id: "inquiry-1",
      intent: "verify",
      question: "这个数字的来源是什么？",
      anchor: {
        documentId: "doc-1",
        blockId: "block-1",
        headingPath: ["市场分析"],
        quote: "CAGR ≈ 20%",
        prefix: "增长：",
        suffix: "。",
        start: 3,
        end: 13,
        matchStatus: "matched",
      },
      status: "understood",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "它表示复合年增长率。",
          createdAt: "2026-09-21T00:00:00.000Z",
          providerId: "demo",
          providerName: "演示回答",
          mode: "demo",
          sources: [
            {
              id: "source-1",
              title: "Investopedia",
              url: "https://www.investopedia.com/terms/c/cagr.asp",
              domain: "investopedia.com",
              snippet: "A definition",
            },
          ],
        },
      ],
      understanding: "我能用年化的方式比较增长。",
      createdAt: "2026-09-21T00:00:00.000Z",
      updatedAt: "2026-09-21T00:00:00.000Z",
      completedAt: "2026-09-21T00:00:00.000Z",
    },
  ],
  activeInquiryId: "inquiry-1",
  activeProviderId: "demo",
  updatedAt: "2026-09-21T00:00:00.000Z",
  hasUnexportedChanges: false,
};

describe("workspace exports", () => {
  it("allows completion and export without paraphrasing, while blocking unanswered or running threads", () => {
    expect(canCompleteInquiry(workspace.inquiries[0])).toBe(false);
    const inquiry = { ...workspace.inquiries[0], understanding: "", messages: workspace.inquiries[0].messages.map(message => ({ ...message, mode: "live" as const })) };
    expect(canCompleteInquiry(inquiry)).toBe(true);
    expect(canCompleteInquiry({ ...inquiry, status: "answering" })).toBe(false);
    expect(canCompleteInquiry({ ...inquiry, messages: [] })).toBe(false);
    const completed = { ...workspace, inquiries: [{ ...inquiry, status: "distilled" as const }] };
    const markdown = workspaceToMarkdown(completed);
    expect(markdown).toContain("它表示复合年增长率。");
    expect(markdown).not.toContain("尚未填写");
    expect(markdown).not.toContain("### 我的理解");
    expect(JSON.parse(workspaceToJson(completed)).inquiries[0].status).toBe("distilled");
    expect(JSON.parse(workspaceToJson(completed)).inquiries[0].messages[0].sources).toHaveLength(1);
  });
  it("exports Markdown knowledge cards with quote, backlink, thread, and source", () => {
    const markdown = workspaceToMarkdown(workspace);

    expect(markdown).toContain("# Got-it · report.md");
    expect(markdown).toContain("CAGR ≈ 20%");
    expect(markdown).toContain("focus-stickies://document/doc-1#block-1");
    expect(markdown).toContain("这个数字的来源是什么？");
    expect(markdown).toContain("它表示复合年增长率。");
    expect(markdown).toContain("[Investopedia](https://www.investopedia.com/terms/c/cagr.asp)");
    expect(markdown).toContain("我能用年化的方式比较增长。");
  });

  it("exports the complete versioned JSON shape without credentials", () => {
    const parsed = JSON.parse(workspaceToJson(workspace)) as Record<string, unknown>;
    const inquiries = parsed.inquiries as Array<Record<string, unknown>>;
    const messages = inquiries[0].messages as Array<Record<string, unknown>>;
    const sources = messages[0].sources as Array<Record<string, unknown>>;

    expect(parsed.schemaVersion).toBe(1);
    expect((parsed.document as Record<string, unknown>).filename).toBe("report.md");
    expect((inquiries[0].anchor as Record<string, unknown>).quote).toBe("CAGR ≈ 20%");
    expect(inquiries[0].understanding).toBe("我能用年化的方式比较增长。");
    expect(messages[0].providerId).toBe("demo");
    expect(sources[0].url).toBe("https://www.investopedia.com/terms/c/cagr.asp");
    expect(parsed).not.toHaveProperty("providerKey");
    expect(parsed).not.toHaveProperty("apiKey");
  });
});
