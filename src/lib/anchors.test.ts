import { describe, expect, it, vi } from "vitest";
import type { Anchor, Inquiry } from "../types";
import {
  applyInquiryHighlights,
  createAnchor,
  emphasizeInquiryHighlight,
  findInquiryHighlight,
  createAnchorFromSelection,
  resolveAnchor,
  resolveAnchorDetailed,
} from "./anchors";

function inquiry(anchor: Anchor, id = "inquiry-1"): Inquiry {
  return {
    id,
    intent: "explain",
    question: "这是什么意思？",
    anchor,
    status: "ready",
    messages: [],
    understanding: "",
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };
}

describe("anchors", () => {
  it("restores an anchor at the exact saved position first", () => {
    const text = "CAGR 表示复合年增长率。";
    const start = text.indexOf("CAGR");
    const anchor = createAnchor({
      documentId: "doc-1",
      blockId: "block-1",
      blockText: text,
      start,
      end: start + 4,
    });

    expect(anchor).not.toBeNull();
    expect(resolveAnchorDetailed(text, anchor!)).toEqual({
      start,
      end: start + 4,
      method: "exact-position",
    });
  });

  it("uses a unique quote when the saved offset moved", () => {
    const anchor = createAnchor({
      documentId: "doc-1",
      blockId: "block-1",
      blockText: "报告先定义 CAGR，再讨论它的用途。",
      start: 0,
      end: 2,
    });
    const changedText = "补充说明后，报告先定义 CAGR，再讨论它的用途。";
    const result = resolveAnchor(changedText, { ...anchor!, start: 0, end: 2 });

    expect(result).toEqual({
      start: changedText.indexOf("报告"),
      end: changedText.indexOf("报告") + 2,
    });
  });

  it("uses context for duplicate quotes but refuses an ambiguous duplicate", () => {
    const text = "前文 A：目标词；后文甲。前文 B：目标词；后文乙。";
    const first = text.indexOf("目标词");
    const anchor = createAnchor({
      documentId: "doc-1",
      blockId: "block-1",
      blockText: text,
      start: first,
      end: first + 3,
      contextLength: 5,
    })!;

    const stale = { ...anchor, start: 999, end: 1002 };
    expect(resolveAnchorDetailed(text, stale)).toEqual({
      start: first,
      end: first + 3,
      method: "context",
    });

    const ambiguous = { ...stale, prefix: "", suffix: "" };
    expect(resolveAnchor(text, ambiguous)).toBeNull();
  });

  it("marks missing wording as unresolved instead of guessing", () => {
    const anchor = createAnchor({
      documentId: "doc-1",
      blockId: "block-1",
      blockText: "这里有一个暂时不再出现的术语。",
      start: 5,
      end: 9,
    })!;
    expect(resolveAnchor("原文已经删掉这个片段。", anchor)).toBeNull();
  });

  it("creates a block-relative anchor from a DOM selection", () => {
    document.body.innerHTML =
      '<article><p data-block-id="b1" data-heading-path="[\"一\"]">认识 <strong>CAGR</strong> 这个词。</p></article>';
    const article = document.querySelector("article") as HTMLElement;
    const paragraph = article.querySelector("p")!;
    const strongText = paragraph.querySelector("strong")!.firstChild!;
    const range = document.createRange();
    range.setStart(strongText, 0);
    range.setEnd(strongText, strongText.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const result = createAnchorFromSelection(selection, article, "doc-1");
    expect("anchor" in result).toBe(true);
    if (!("anchor" in result)) return;
    expect(result.anchor.blockId).toBe("b1");
    expect(result.anchor.quote).toBe("CAGR");
    expect(result.anchor.start).toBe("认识 ".length);
    expect(result.context).toContain("CAGR");
  });

  it("rejects a selection that crosses semantic blocks", () => {
    document.body.innerHTML =
      '<article><p data-block-id="b1">第一段文字</p><p data-block-id="b2">第二段文字</p></article>';
    const article = document.querySelector("article") as HTMLElement;
    const paragraphs = article.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(paragraphs[0].firstChild!, 1);
    range.setEnd(paragraphs[1].firstChild!, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(createAnchorFromSelection(selection, article, "doc-1")).toEqual({
      error: "请将选区限制在同一段或同一表格单元格内。",
    });
  });

  it("highlights restorable inquiries and reports missing anchors", () => {
    document.body.innerHTML = '<article><p data-block-id="b1">CAGR 是复合年增长率。</p></article>';
    const article = document.querySelector("article") as HTMLElement;
    const text = article.querySelector("p")!.textContent!;
    const start = text.indexOf("CAGR");
    const anchor = createAnchor({
      documentId: "doc-1",
      blockId: "b1",
      blockText: text,
      start,
      end: start + 4,
    })!;
    const missing = inquiry({ ...anchor, blockId: "missing" }, "inquiry-2");
    const onMissing = vi.fn();

    const cleanup = applyInquiryHighlights(article, [inquiry(anchor), missing], "inquiry-1", onMissing);
    const mark = article.querySelector("mark[data-inquiry-id=\"inquiry-1\"]");
    expect(mark?.textContent).toBe("CAGR");
    expect(mark?.className).toContain("is-active");
    expect(onMissing).toHaveBeenCalledWith(missing);

    cleanup();
    expect(article.querySelector("mark[data-focus-stickies-highlight]")).toBeNull();
  });

  it("groups exact anchors by unique function, keeps the click representative and follows active intent", () => {
    const article = document.createElement("article");
    article.innerHTML = '<p data-block-id="b1">CAGR 与 CAGR</p>';
    const text = article.textContent!;
    const anchor = createAnchor({ documentId: "doc", blockId: "b1", blockText: text, start: 0, end: 4 })!;
    const items: Inquiry[] = [
      inquiry(anchor, "explain"),
      { ...inquiry(anchor, "verify"), intent: "verify" },
      { ...inquiry(anchor, "entity"), intent: "entity" },
      inquiry(anchor, "duplicate"),
      { ...inquiry(createAnchor({ documentId: "doc", blockId: "b1", blockText: text, start: 7, end: 11 })!, "other"), intent: "entity" },
    ];
    applyInquiryHighlights(article, items, null);
    expect(article.querySelectorAll("mark")).toHaveLength(2);
    let first = article.querySelector("mark")!;
    expect(first.dataset.inquiryId).toBe("explain");
    expect(first.dataset.intents).toBe("explain verify entity");
    expect(first.getAttribute("style")).toBeNull();
    expect(first.dataset.multiIntent).toBeUndefined();
    expect(first.getAttribute("aria-label")).toContain("解释一下、查找来源、介绍一下");
    for (const id of ["verify", "entity"]) {
      applyInquiryHighlights(article, items, id);
      first = article.querySelector("mark")!;
      expect(first.dataset.inquiryId).toBe(id);
      expect(first.dataset.intent).toBe(id);
      expect(first.classList.contains("is-active")).toBe(true);
      expect(article.textContent).toBe(text);
    }
    expect(items.map(i => i.intent)).toEqual(["explain", "verify", "entity", "explain", "entity"]);
  });

  it("preserves why identity and repairs a relinked single highlight with its own function", () => {
    const article = document.createElement("article");
    article.innerHTML = '<p data-block-id="b1">CAGR</p>';
    const anchor = createAnchor({ documentId: "doc", blockId: "b1", blockText: "CAGR", start: 0, end: 4 })!;
    const why: Inquiry = { ...inquiry(anchor, "why"), intent: "why" };
    applyInquiryHighlights(article, [why, inquiry(anchor)], null);
    let mark = article.querySelector("mark")!;
    expect(mark.dataset.multiIntent).toBeUndefined();
    expect(mark.getAttribute("aria-label")).toContain("为什么");
    expect(mark.getAttribute("style")).toBeNull();
    const onResolved = vi.fn();
    const stale = { ...why, anchor: { ...anchor, matchStatus: "needs-relink" as const } };
    applyInquiryHighlights(article, [stale], "why", undefined, onResolved);
    mark = article.querySelector("mark")!;
    expect(mark.dataset.intent).toBe("why");
    expect(mark.getAttribute("aria-label")).toContain("为什么");
    expect(onResolved).toHaveBeenCalledWith(stale);
  });
});

it("moves transient emphasis between rendered anchors without changing the active thread or text", () => {
  const article = document.createElement("article");
  article.innerHTML = '<p data-block-id="b1">CAGR 与 CAGR</p>';
  const text = article.textContent!;
  const anchor = (start: number) => createAnchor({ documentId: "doc", blockId: "b1", blockText: text, start, end: start + 4 })!;
  const items = [inquiry(anchor(0), "first"), inquiry(anchor(0), "duplicate"), inquiry(anchor(7), "second")];
  applyInquiryHighlights(article, items, "first");
  expect(findInquiryHighlight(article, items, "duplicate")).toBe(article.querySelector("mark"));
  emphasizeInquiryHighlight(article, items, "second");
  expect(article.querySelectorAll(".is-emphasized")).toHaveLength(1);
  expect(article.querySelector<HTMLElement>(".is-emphasized")?.dataset.inquiryId).toBe("second");
  expect(article.querySelector<HTMLElement>(".is-active")?.dataset.inquiryId).toBe("first");
  for (const id of [null, "missing"]) {
    emphasizeInquiryHighlight(article, items, id);
    expect(article.querySelector(".is-emphasized")).toBeNull();
  }
  applyInquiryHighlights(article, items, null);
  emphasizeInquiryHighlight(article, items, "duplicate");
  expect(article.querySelectorAll(".is-emphasized")).toHaveLength(1);
  expect(article.textContent).toBe(text);
});
