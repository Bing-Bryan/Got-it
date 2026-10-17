import { describe, expect, it } from "vitest";
import { pdfParagraphs, type PdfTextItem } from "./pdf-paragraphs";

// Synthetic pages in PDF user space (612 x 792, y grows upward); all text is invented.
const view: [number, number, number, number] = [0, 0, 612, 792];
const item = (str: string, x: number, y: number, width = str.length * 5, height = 10): PdfTextItem => ({ str, x, y, width, height });
const column = (x: number, top: number, lines: string[], step = 12) => lines.map((s, i) => item(s, x, top - i * step));

describe("pdfParagraphs", () => {
  it("joins wrapped lines into paragraphs and splits on vertical gaps", () => {
    const items = [
      ...column(72, 700, ["The first paragraph starts on this line and", "continues on the next line of the same block."]),
      ...column(72, 660, ["A second paragraph begins after a clear gap", "and also wraps onto a following line here."]),
    ];
    const { paragraphs, scanned } = pdfParagraphs(3, items, view);
    expect(scanned).toBe(false);
    expect(paragraphs.map(p => p.text)).toEqual([
      "The first paragraph starts on this line and continues on the next line of the same block.",
      "A second paragraph begins after a clear gap and also wraps onto a following line here.",
    ]);
    expect(paragraphs.map(p => p.id)).toEqual(["pdf-p3-b0", "pdf-p3-b1"]);
  });

  it("reads a two-column page left column first, keeping a spanning title in place", () => {
    const items = [
      item("A spanning section title for both columns", 72, 720, 460),
      ...column(72, 690, ["Left column text sits here and keeps", "going down the left side of the page."], 12).map(i => ({ ...i, width: 220 })),
      ...column(330, 690, ["Right column text sits here and keeps", "going down the right side of the page."], 12).map(i => ({ ...i, width: 220 })),
    ];
    const texts = pdfParagraphs(1, items, view).paragraphs.map(p => p.text);
    expect(texts[0]).toBe("A spanning section title for both columns");
    expect(texts.indexOf("Left column text sits here and keeps going down the left side of the page.")).toBeLessThan(texts.indexOf("Right column text sits here and keeps going down the right side of the page."));
    expect(texts.join(" ")).not.toMatch(/keeps Right|keeps going down the right side of the page\. going/);
  });

  it.each([10, 18, 24])("keeps columns apart when the gutter is only %ipt wide", gutter => {
    const width = (612 - 144 - gutter) / 2, items: PdfTextItem[] = [];
    for (let i = 0; i < 6; i++) items.push(item(`Left column line ${i} keeps going here`, 72, 700 - i * 12, width), item(`Right column line ${i} keeps going here`, 72 + width + gutter, 700 - i * 12, width));
    const texts = pdfParagraphs(1, items, view).paragraphs.map(p => p.text);
    expect(texts).toEqual([0, 1, 2, 3, 4, 5].map(i => `Left column line ${i} keeps going here`).join(" ").split("\u0000").concat([0, 1, 2, 3, 4, 5].map(i => `Right column line ${i} keeps going here`).join(" ")));
  });

  it("keeps a full-width abstract as one paragraph on a page whose chart labels look two-column", () => {
    const labels = Array.from({ length: 8 }, (_, i) => [item(`Left label ${i}`, 72, 300 - i * 12, 120), item(`Right label ${i}`, 400, 300 - i * 12, 120)]).flat();
    const abstract = column(80, 700, ["The abstract starts here and runs across the whole width", "of the page for several lines before the charts begin", "and ends on this final line of the abstract text."]).map(i => ({ ...i, width: 450 }));
    const texts = pdfParagraphs(1, [...abstract, ...labels], view).paragraphs.map(p => p.text);
    expect(texts[0]).toBe("The abstract starts here and runs across the whole width of the page for several lines before the charts begin and ends on this final line of the abstract text.");
  });

  it("drops running headers, footers, bare page numbers and letterless formula lines", () => {
    const items = [
      item("Short Running Header", 72, 780),
      ...column(72, 700, ["Body text that should be kept for translation", "because it is the actual reading content."]),
      item("x = y + 2 = 3", 72, 640),
      item("12", 300, 20),
      item("Footer note", 72, 15),
    ];
    const texts = pdfParagraphs(2, items, view).paragraphs.map(p => p.text);
    expect(texts).toEqual(["Body text that should be kept for translation because it is the actual reading content."]);
  });

  it("leaves chart legends and table rows on the original page but keeps short headings", () => {
    const items = [
      item("Agentic and Competitive Coding", 72, 720),
      item("Kimi-K2-Instruct OpenAI GPT-4.1 Claude 4 Opus Kimi-K2-Instruct Gemini 2.5 Flash non-thinking", 72, 690),
      ...column(72, 650, ["Body prose explains the result and how it was measured", "across the benchmarks that are listed in the chart."]),
    ];
    expect(pdfParagraphs(1, items, view).paragraphs.map(p => p.text)).toEqual([
      "Agentic and Competitive Coding",
      "Body prose explains the result and how it was measured across the benchmarks that are listed in the chart.",
    ]);
  });

  it("keeps only valid line boxes inside the page for each paragraph", () => {
    const items = [...column(72, 700, ["A paragraph whose first line sits inside the page and", "whose second line continues the same text here."]), item("overflowing words beyond the edge", 620, 676)];
    const [paragraph] = pdfParagraphs(1, items, view).paragraphs;
    expect(paragraph.rects.length).toBeGreaterThan(0);
    for (const r of paragraph.rects) { expect(r[2]).toBeGreaterThan(r[0]); expect(r[3]).toBeGreaterThan(r[1]); expect(r[0]).toBeGreaterThanOrEqual(0); expect(r[2]).toBeLessThanOrEqual(612); }
  });

  it("removes hyphenation at line ends when the next line continues the word", () => {
    const items = column(72, 700, ["The optimizer improves stabil-", "ity during long training runs for the model."]);
    expect(pdfParagraphs(1, items, view).paragraphs[0].text).toBe("The optimizer improves stability during long training runs for the model.");
  });

  it("marks pages without usable text as scanned", () => {
    expect(pdfParagraphs(5, [], view)).toEqual({ page: 5, paragraphs: [], scanned: true });
    // A page with a few words has a text layer: not "image only", just nothing to translate.
    expect(pdfParagraphs(5, [item("Fig. 3", 72, 400)], view)).toEqual({ page: 5, paragraphs: [], scanned: false });
  });

  it("is deterministic for the same input", () => {
    const items = column(72, 700, ["Same input should always produce the same", "paragraph output for both browser and server."]);
    expect(pdfParagraphs(1, items, view)).toEqual(pdfParagraphs(1, [...items].reverse(), view));
  });
});
