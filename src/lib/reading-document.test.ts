import { describe, expect, it } from "vitest";
import { createInitialWorkspace } from "../sample";
import { renderMarkdown } from "./markdown";
import { workspaceToJson } from "./export";
import { hasRunningAnswers, MAX_READING_FILE_BYTES, parseReadingDocument, readDocumentFile, readingDocumentFilename, workspaceToReadingDocument } from "./reading-document";

function fixture() {
  const w = createInitialWorkspace();
  const div = document.createElement("div"); div.innerHTML = renderMarkdown(w.document.markdown).html;
  const p = [...div.querySelectorAll("p")].find(p => p.textContent?.includes("CAGR"))!;
  const start = p.textContent!.indexOf("CAGR");
  w.inquiries = [{ id: "i1", intent: "verify", question: "查证CAGR", anchor: { documentId: w.document.id, blockId: p.dataset.blockId!, headingPath: [], quote: "CAGR", prefix: "", suffix: "", start, end: start + 4, textVersion: 2, matchStatus: "matched" }, status: "distilled", understanding: "增长不是每年相同", createdAt: "2026", updatedAt: "2026", messages: [
    { id: "old", role: "assistant", content: "旧回答", createdAt: "2025" },
    { id: "m1", role: "assistant", content: "本次查证缺少证据", createdAt: "2026", completion: "complete", evidenceStatus: "partial", search: { status: "executed", completedSearches: 1, failedSearches: 0 }, modelConfig: { model: "gpt-5.5", reasoningEffort: "high" }, sources: [{ id: "s1", title: "来源", url: "https://example.com", domain: "example.com", excerptKind: "unverified", relation: "unknown" }] },
  ] }];
  w.activeInquiryId = "i1"; w.activeTab = { anchorInquiryId: "i1", intent: "verify" }; w.hasUnexportedChanges = true;
  return w;
}

describe("portable reading documents", () => {
  it("round-trips original text, all histories, evidence boundaries, understanding, status and focus", () => {
    const w = fixture(); const restored = parseReadingDocument(workspaceToReadingDocument(w));
    expect(restored.document).toEqual(w.document);
    expect(restored.inquiries).toEqual(w.inquiries);
    expect(restored.activeTab).toEqual(w.activeTab);
    expect(restored.activeInquiryId).toBe("i1");
    expect(restored.hasUnexportedChanges).toBe(false);
    expect(w.hasUnexportedChanges).toBe(true);
  });
  it("strips runtime secrets at each level and restores old JSON without inventing evidence", () => {
    const w = fixture(); Object.assign(w, { apiKey: "secret-key" }); Object.assign(w.inquiries[0].messages[0], { rawLog: "raw-log" });
    const file = workspaceToReadingDocument(w);
    expect(file).not.toContain("secret-key"); expect(file).not.toContain("raw-log");
    const old = parseReadingDocument(workspaceToJson(w), true);
    expect(old.inquiries[0].messages[0].search).toBeUndefined();
    expect(old.inquiries[0].messages[0].modelConfig).toBeUndefined();
    expect(old.inquiries[0].status).toBe("distilled");
  });
  it("interrupts only the saved snapshot and preserves partial text", () => {
    const w = fixture(); w.inquiries[0].status = "answering"; w.inquiries[0].messages[1].completion = "provisional";
    const restored = parseReadingDocument(workspaceToReadingDocument(w));
    expect(restored.inquiries[0].status).toBe("ready"); expect(restored.inquiries[0].lastError).toContain("中断");
    expect(restored.inquiries[0].messages[1].completion).toBe("interrupted");
    expect(restored.inquiries[0].messages[1].content).toBe("本次查证缺少证据");
    expect(hasRunningAnswers(w)).toBe(true); expect(hasRunningAnswers(restored)).toBe(false);
    expect(w.inquiries[0].messages[1].completion).toBe("provisional");
  });
  it.each(["", "{broken", "null", "[]", '{"format":"other"}', '{"format":"focus-stickies-reading-document","version":2}'])("rejects broken or unsupported file %s", content => {
    expect(() => parseReadingDocument(content)).toThrow();
  });
  it("rejects duplicate IDs and cross-document or negative anchors", () => {
    const w = fixture(); w.inquiries.push(w.inquiries[0]); expect(() => parseReadingDocument(workspaceToJson(w), true)).toThrow(/关联/);
    w.inquiries.pop(); w.inquiries[0].anchor.documentId = "other"; expect(() => parseReadingDocument(workspaceToJson(w), true)).toThrow(/关联/);
    w.inquiries[0].anchor.documentId = w.document.id; w.inquiries[0].anchor.start = -1; expect(() => parseReadingDocument(workspaceToJson(w), true)).toThrow(/关联/);
  });
  it("falls back from a missing active inquiry and rejects bare JSON named .focus", () => {
    const w = fixture(); w.activeInquiryId = "missing"; w.activeTab = { anchorInquiryId: "missing", intent: "entity" };
    expect(parseReadingDocument(workspaceToJson(w), true).activeInquiryId).toBeNull();
    expect(parseReadingDocument(workspaceToJson(w), true).activeTab).toBeUndefined();
    expect(() => parseReadingDocument(workspaceToJson(w))).toThrow(/格式/);
  });
  it("keeps empty categories and handles UTF-8 BOM", () => {
    const w = fixture(); w.activeTab = { intent: "entity" }; w.activeInquiryId = null;
    expect(parseReadingDocument('\uFEFF' + workspaceToReadingDocument(w)).activeTab).toEqual({ intent: "entity" });
  });
  it("checks size and type before reading and reports read failures safely", async () => {
    let read = false;
    const file = { name: "x.focus", size: MAX_READING_FILE_BYTES + 1, text: async () => { read = true; return ""; } };
    await expect(readDocumentFile(file)).rejects.toThrow(/20 MB/); expect(read).toBe(false);
    await expect(readDocumentFile({ ...file, size: 1, name: "x.exe" })).rejects.toThrow(/请选择/); expect(read).toBe(false);
    await expect(readDocumentFile({ ...file, size: 1, text: async () => { throw new Error("sensitive-path"); } })).rejects.toThrow("文件读取失败，请重新选择。当前文档未替换。");
  });
  it("imports Markdown unchanged and creates safe reading filenames", async () => {
    const markdown = "# 标题\n==重点==\n";
    const w = await readDocumentFile({ name: "report.md", size: markdown.length, text: async () => markdown });
    expect(w.document.markdown).toBe(markdown); expect(w.inquiries).toEqual([]); expect(readingDocumentFilename(w)).toBe("report.focus");
    w.document.filename = "../bad:name.md"; expect(readingDocumentFilename(w)).toBe("..-bad-name.focus");
    await expect(readDocumentFile({ name: "empty.md", size: 0, text: async () => "" })).rejects.toThrow(/空/);
  });
});
