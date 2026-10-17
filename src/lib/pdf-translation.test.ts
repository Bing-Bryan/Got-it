import { expect, it } from "vitest";
import { pdfSourceFromPages } from "./pdf-translation";

const page = (text: string) => [{ page: 1, scanned: false, paragraphs: [{ id: "pdf-p1-b0", page: 1, text, rects: [[0, 0, 10, 10] as [number, number, number, number]] }] }];
const joined = (text: string) => pdfSourceFromPages(page(text), "a".repeat(64)).source.units.map(u => u.text);

it("splits a long paragraph at sentence ends without losing characters", () => {
  const text = "...." + "This sentence is part of a long synthetic paragraph. ".repeat(80);
  const units = joined(text);
  expect(units.length).toBeGreaterThan(1);
  expect(units.every(u => u.length <= 3600)).toBe(true);
  expect(units.join(" ").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
});

it("cuts a sentence with no end punctuation at a space, never inside a word", () => {
  const words = Array.from({ length: 900 }, (_, i) => `word${i}`);
  const units = joined(words.join(" "));
  expect(units.length).toBeGreaterThan(1);
  expect(units.flatMap(u => u.split(" "))).toEqual(words);
});

it("keeps web addresses out of the text sent for translation and restores them in the draft", async () => {
  const { restorePdfKeeps } = await import("./pdf-translation");
  const { validUnitTranslation } = await import("./web-translation");
  const text = "The weights are released at https://example.com/models/k2-instruct for research, see also www.example.org/docs.";
  const source = pdfSourceFromPages(page(text), "a".repeat(64)), [unit] = source.source.units;
  expect(unit.text).toBe("The weights are released at [GOTIT_KEEP_0] for research, see also [GOTIT_KEEP_1].");
  const translated = "权重发布在 [GOTIT_KEEP_0]，供研究使用，另见 [GOTIT_KEEP_1]。";
  expect(validUnitTranslation(unit, translated)).toBe(true);
  expect(restorePdfKeeps(source, unit.id, translated)).toBe("权重发布在 https://example.com/models/k2-instruct，供研究使用，另见 www.example.org/docs。");
});

it("protects addresses that the PDF text layer spells out with spaces", async () => {
  const { restorePdfKeeps } = await import("./pdf-translation");
  const text = "[13] A synthetic reference entry for testing the paper. 2024. URL: https : / / arxiv . org / abs / 2406 . 13542.";
  const source = pdfSourceFromPages(page(text), "a".repeat(64)), [unit] = source.source.units;
  expect(unit.text).toBe("[13] A synthetic reference entry for testing the paper. 2024. URL: [GOTIT_KEEP_0].");
  expect(restorePdfKeeps(source, unit.id, "【13】测试用参考文献。2024。网址：[GOTIT_KEEP_0]。")).toBe("【13】测试用参考文献。2024。网址：https://arxiv.org/abs/2406.13542。");
});

it("does not let a normal address swallow the word after its sentence full stop", async () => {
  const { restorePdfKeeps } = await import("./pdf-translation");
  const text = "See https://example.com/foo. This paper explains the result and the method.";
  const source = pdfSourceFromPages(page(text), "a".repeat(64)), [unit] = source.source.units;
  expect(unit.text).toBe("See [GOTIT_KEEP_0]. This paper explains the result and the method.");
  expect(restorePdfKeeps(source, unit.id, "见 [GOTIT_KEEP_0]。本文解释了结果与方法。")).toBe("见 https://example.com/foo。本文解释了结果与方法。");
});

it("keeps a semi-spaced address together even when only a space follows the dot", async () => {
  const { restorePdfKeeps } = await import("./pdf-translation");
  const text = "Reference URL https://arxiv. org/abs/2411.07140. Another sentence follows here.";
  const source = pdfSourceFromPages(page(text), "a".repeat(64)), [unit] = source.source.units;
  expect(unit.text).toBe("Reference URL [GOTIT_KEEP_0]. Another sentence follows here.");
  expect(restorePdfKeeps(source, unit.id, "参考网址 [GOTIT_KEEP_0]。后文另一句。")).toBe("参考网址 https://arxiv.org/abs/2411.07140。后文另一句。");
});
