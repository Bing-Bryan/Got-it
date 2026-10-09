import { resetTestLibrary, testWorkspace } from "./test-support/library";
vi.mock("./lib/library-client", async () => ({ libraryRequest: (await import("./test-support/library")).testLibraryRequest }));
import { TEST_MODELS } from "../server/test-support/model-catalog";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { createInitialWorkspace } from "./sample";
import { renderMarkdown } from "./lib/markdown";
import { STORAGE_KEY } from "./lib/storage";
import { parseReadingDocument, workspaceToReadingDocument } from "./lib/reading-document";
import type { InquiryEvent, InquiryRequest, Workspace } from "./types";
const { stream, download } = vi.hoisted(() => ({ stream: vi.fn(), download: vi.fn((_filename: string, _content: string, _mime?: string) => true) }));
vi.mock("./lib/inquiry-stream", async original => ({ ...await original<typeof import("./lib/inquiry-stream")>(), readInquiryStream: stream }));
vi.mock("./lib/export", async original => ({ ...await original<typeof import("./lib/export")>(), downloadTextFile: download }));
let root: Root, host: HTMLDivElement, w: Workspace;
const stored = (): Workspace => testWorkspace();
async function click(selector: string) { await act(async () => (host.querySelector(selector) as HTMLElement).click()); }
async function openFile(name: string, text: string | (() => Promise<string>)) {
  const file = new File([], name);
  Object.defineProperty(file, "text", { value: typeof text === "string" ? async () => text : text });
  await act(async () => {
    const input = host.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(async () => {
  resetTestLibrary();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLElement.prototype.scrollIntoView = vi.fn(); HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ models: TEST_MODELS, providers: [{ id: "codex", name: "Codex", availability: "connected", supportsWebSearch: true }], defaultProviderId: "codex" }) })));
  w = createInitialWorkspace();
  const div = document.createElement("div"); div.innerHTML = renderMarkdown(w.document.markdown!).html;
  const p = [...div.querySelectorAll("p")].find(p => p.textContent?.includes("CAGR"))!; const start = p.textContent!.indexOf("CAGR");
  w.inquiries = [{ id: "explain", intent: "explain", question: "解释CAGR", anchor: { documentId: w.document.id, blockId: p.dataset.blockId!, headingPath: [], quote: "CAGR", prefix: "", suffix: "", start, end: start + 4, textVersion: 2, matchStatus: "matched" }, status: "ready", messages: [{ id: "old", role: "assistant", content: "已有解释", createdAt: "2026", completion: "complete" }], understanding: "", createdAt: "2026", updatedAt: "2026" }];
  w.activeInquiryId = "explain"; w.activeProviderId = "codex"; w.hasUnexportedChanges = true;
  w.modelPreferences = { explain: { model: "gpt-5.5", reasoningEffort: "high" } }; w.modelDefaultsVersion = 4;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); stream.mockReset(); download.mockClear(); download.mockReturnValue(true);
  await act(async () => root.render(<App />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.removeItem(STORAGE_KEY); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reopens a legacy reading file with its original, highlight and answer without generating", async () => {
  const name = "legacy.focus", content = workspaceToReadingDocument(w);
  expect(name).toMatch(/\.focus$/); expect(parseReadingDocument(content).inquiries[0].messages[0].content).toBe("已有解释");
  expect(stored().hasUnexportedChanges).toBe(true);
  await openFile("other.md", "# 另一篇\n另一个正文"); expect(host.textContent).toContain("另一个正文");
  await openFile(name, content); expect(host.querySelector(".answer-markdown")?.textContent).toContain("已有解释");
  expect(host.querySelector('mark[data-inquiry-id="explain"]')?.textContent).toBe("CAGR");
  expect(stored().modelPreferences?.explain).toEqual({ model: "gpt-5.5", reasoningEffort: "high" }); expect(stream).not.toHaveBeenCalled();
});
it("validates before adding and retains earlier reading without requiring an export confirmation", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await openFile("broken.focus", "{bad"); expect(confirm).not.toHaveBeenCalled(); expect(host.textContent).toContain("文件为空或已损坏");
  await openFile("other.md", "# 另一篇"); expect(confirm).not.toHaveBeenCalled(); expect(host.textContent).toContain("另一篇"); expect(host.querySelector(".library-current")?.textContent).toContain("other.md");
});
it("keeps running requests on invalid/cancelled opens and discards late events after a valid replacement", async () => {
  let emit!: (event: InquiryEvent) => void, signal!: AbortSignal, finish!: () => void;
  stream.mockImplementation((_r: InquiryRequest, cb: typeof emit, s: AbortSignal) => { emit = cb; signal = s; return new Promise<void>(resolve => { finish = resolve; }); });
  await click(".explain-again-action"); const request = stream.mock.calls[0][0];
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await openFile("bad.json", "{}"); expect(signal.aborted).toBe(false);
  await click(".library-add"); expect(signal.aborted).toBe(false);
  confirm.mockReturnValue(true);
  // Reopening the same IDs must still isolate responses from the previous session.
  await openFile("same.focus", workspaceToReadingDocument(w)); expect(signal.aborted).toBe(true);
  await act(async () => { emit({ type: "answer-delta", delta: "迟到的内容", requestId: request.requestId, sequence: 2 }); finish(); });
  expect(host.textContent).not.toContain("迟到的内容"); expect(stored().inquiries[0].messages).toHaveLength(1); expect(stream).toHaveBeenCalledTimes(1);
});

it("ignores stale file reads and keeps the most recently selected material", async () => {
  let finish!: (content: string) => void;
  await openFile("slow.md", () => new Promise(resolve => { finish = resolve; }));
  await openFile("fast.md", "# 最新选择"); await act(async () => finish("# 过时文档"));
  expect(stored().document.filename).toBe("fast.md");
  expect(host.textContent).not.toContain("过时文档");
});
it("imports legacy JSON but keeps local future preferences and preserves message model snapshots", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const other = structuredClone(w); other.modelPreferences = { explain: { model: "gpt-6-luna", reasoningEffort: "low" } }; other.inquiries[0].messages[0].modelConfig = { model: "gpt-5.6-luna", reasoningEffort: "max" };
  await openFile("legacy.json", JSON.stringify(other));
  expect(stored().modelPreferences?.explain?.model).toBe("gpt-5.5"); expect(stored().inquiries[0].messages[0].modelConfig?.model).toBe("gpt-5.6-luna"); expect(stream).not.toHaveBeenCalled();
});
it("keeps only the left add action without file menu or backup actions", () => {
  expect(host.querySelector(".export-menu, .reading-file-actions, .save-reading-button")).toBeNull();
  expect(host.querySelectorAll(".library-add")).toHaveLength(1);
});

it("can explicitly request another explanation after reopening using saved history", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await openFile("continue.focus", workspaceToReadingDocument(w));
  expect(stream).not.toHaveBeenCalled(); stream.mockRejectedValue(new Error("受控测试：离线"));
  await click(".explain-again-action");
  expect(stream).toHaveBeenCalledOnce();
  expect(stream.mock.calls[0][0].quote).toBe("CAGR");
  expect(stream.mock.calls[0][0].history.some((m: {content: string}) => m.content === "已有解释")).toBe(true);
  expect(host.textContent).toContain("已有解释"); expect(host.textContent).toContain("受控测试：离线");
});

it.each(["failure", "stop"])("keeps source lookup visibly unfinished after %s, including after list navigation", async mode => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  w.inquiries[0].intent = "verify";
  w.inquiries[0].messages[0].operation = "verify";
  await openFile("lookup.focus", workspaceToReadingDocument(w));
  if (mode === "failure") stream.mockRejectedValue(new Error("受控连接失败"));
  else stream.mockImplementation(() => new Promise(() => {}));
  await click('.verify-again-action');
  if (mode === "stop") await click('.stop-action');
  expect(host.querySelector('.thread-messages > .assistant-message .verification-conclusion')?.textContent).toBe('本次查找已中断');
  expect(host.querySelector('.empty-sources')).toBeNull();
  expect(host.querySelector('.inquiry-actions .primary-action')).toBeNull();
  expect((host.querySelector('.verify-again-action') as HTMLButtonElement).disabled).toBe(false);
  await click('.return-to-list');
  expect(stored().inquiries[0].status).not.toBe('understood');
  expect(stored().inquiries[0].messages.at(-1)?.completion).toBe('interrupted');
  await click('.category-open');
  expect(host.querySelector('.thread-messages > .assistant-message .verification-conclusion')?.textContent).toBe('本次查找已中断');
  expect(host.querySelector('.inquiry-actions .primary-action')).toBeNull();
});
