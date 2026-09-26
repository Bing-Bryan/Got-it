import { describe, expect, it } from "vitest";
import { createInitialWorkspace } from "../sample";
import { saveWorkspace, loadWorkspace, WORKSPACE_STORAGE_KEY } from "./storage";
import { workspaceToJson, workspaceToMarkdown } from "./export";
import type { Inquiry, Source } from "../types";
const source: Source = { id: "s", title: "CERN", url: "https://home.cern/science/computing/birth-web", domain: "home.cern", excerpt: "CERN public source quote", excerptKind: "quote", retrievalStatus: "matched", relation: "supports", locatable: true, checkedAt: "2026-09-22" };
function workspace() {
  const workspace = createInitialWorkspace();
  const item: Inquiry = { id: "test", intent: "verify", question: "来源？", anchor: { documentId: workspace.document.id, blockId: "b", headingPath: [], quote: "报告原文", prefix: "", suffix: "", start: 0, end: 4, matchStatus: "matched" }, status: "understood", messages: [{ id: "m", role: "assistant", content: "查证结果", createdAt: "2026-09-22", evidenceStatus: "partial", sources: [source], search: { status: "executed", completedSearches: 1, failedSearches: 0 } }], understanding: "", createdAt: "2026-09-22", updatedAt: "2026-09-22" };
  workspace.inquiries = [item]; workspace.activeInquiryId = item.id;
  return workspace;
}
describe("evidence persistence and export", () => {
  it("roundtrips evidence independently of completion and removes runtime fields", () => {
    const value = workspace();
    Object.assign(value.inquiries[0].messages[0].search!, { rawEvents: "private", token: "secret" });
    Object.assign(value.inquiries[0].messages[0].sources![0], { html: "entire webpage", apiKey: "secret" });
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
    expect(saveWorkspace(value, storage).ok).toBe(true);
    const restored = loadWorkspace(storage)!;
    expect(restored.inquiries[0].status).toBe("understood");
    expect(restored.inquiries[0].messages[0].evidenceStatus).toBe("partial");
    expect(restored.inquiries[0].messages[0].sources![0].locatable).toBe(true);
    const json = workspaceToJson(restored);
    expect(json).not.toMatch(/private|secret|entire webpage/);
    const md = workspaceToMarkdown(restored);
    expect(md).toContain("已执行搜索"); expect(md).toContain("原文引用"); expect(md).toContain("CERN public source quote"); expect(md).toContain("partial");
  });
  it("loads old sources without turning snippets into verified quotes", () => {
    const old = workspace();
    delete old.inquiries[0].messages[0].search;
    old.inquiries[0].messages[0].sources = [{ id: "old", title: "old", url: "https://example.com", domain: "example.com", snippet: "old snippet" }];
    const restored = loadWorkspace({ getItem: (key) => key === WORKSPACE_STORAGE_KEY ? JSON.stringify(old) : null, setItem() {}, removeItem() {} })!;
    expect(restored.inquiries[0].messages[0].sources![0].excerptKind).toBeUndefined();
    expect(workspaceToMarkdown(restored)).toContain("无法确认搜索状态");
    expect(workspaceToMarkdown(restored)).toContain("未核对片段");
  });
});
