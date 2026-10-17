// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadingLibrary } from "./reading-library";
import { WebTranslations } from "./web-translations";
import { readDocumentFile } from "../src/lib/reading-document-core";
import { documentTranslationSource } from "../src/lib/document-translation";
import { TRANSLATION_PLACEHOLDER } from "../src/lib/web-translation";

let dir = "";
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
const text = "# Notes\n\nThe first paragraph explains the idea in plain English for the reader.\n\nA second paragraph keeps `inline code` unchanged for the reader.\n";
async function setup() {
  dir = await mkdtemp(join(tmpdir(), "md-translation-"));
  const l = new ReadingLibrary(dir);
  const e = await l.add(await readDocumentFile({ name: "notes.md", size: text.length, text: async () => text }), "md");
  const ts = documentTranslationSource(e.workspace.document)!;
  const request = { operationId: "md-batch", roundId: "round", translationId: "translation", revisionId: e.revisionId, sourceVersion: ts.sourceVersion, unitIds: ts.source.units.map(u => u.id) };
  return { l, e, ts, request };
}
const keep = (t: string) => { const tokens = t.match(TRANSLATION_PLACEHOLDER) ?? []; return tokens.length ? `中文${tokens.join("中文")}中文` : "中文译文"; };

it("translates Markdown batches with units rebuilt from the saved original", async () => {
  const { l, e, ts, request } = await setup();
  const translate = vi.fn(async (units: { id: string; text: string }[]) => ({ modelConfig: { model: "gpt-6-luna", reasoningEffort: "medium" }, units: Object.fromEntries(units.map(u => [u.id, keep(u.text)])) }));
  const result = await new WebTranslations(l, { translateWebBatch: translate as never }).batch(e.id, request);
  expect(result.sourceVersion).toBe(ts.sourceVersion);
  expect(Object.keys(result.units).sort()).toEqual([...request.unitIds].sort());
  const sent = translate.mock.calls[0][0].map(u => u.text).join("\n");
  expect(sent).toContain("The first paragraph explains");
  expect(sent).not.toContain("inline code");
});

it("rejects unknown units and a stale Markdown source version without calling the model", async () => {
  const { l, e, request } = await setup();
  const translate = vi.fn();
  const jobs = new WebTranslations(l, { translateWebBatch: translate });
  await expect(jobs.batch(e.id, { ...request, operationId: "stale", sourceVersion: "b".repeat(64) })).rejects.toMatchObject({ code: "translation_version" });
  await expect(jobs.batch(e.id, { ...request, operationId: "injected", unitIds: ["injected--v2-part0"] })).rejects.toMatchObject({ code: "translation_unauthorized" });
  expect(translate).not.toHaveBeenCalled();
});
