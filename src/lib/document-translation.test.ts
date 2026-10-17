import { describe, expect, it } from "vitest";
import { documentTranslationSource, markdownTranslationVersion } from "./document-translation";
import { pdfTranslationVersion } from "./pdf-translation";
import { readDocumentFile } from "./reading-document-core";
import { sanitizeWorkspace } from "./storage";
import { translatedRendering } from "./translation-reading";
import { TRANSLATION_CONTRACT_VERSION, TRANSLATION_PLACEHOLDER, translationModelConfig } from "./web-translation";
import type { Workspace } from "../types";

const markdown = "# A plain title\n\nThe first paragraph explains the idea in plain English for the reader.\n\nA second paragraph keeps `inline code` and a [link](https://example.com/page) unchanged.\n\n![Garage](images/garage.jpg)\n\n```js\nconst untouched = true;\n```\n";
async function markdownWorkspace(text = markdown): Promise<Workspace> {
  return (await readDocumentFile({ name: "notes.md", size: text.length, text: async () => text })) as Workspace;
}
// Keeps every protected placeholder in place, as a valid translation must.
const fakeTranslation = (text: string) => { const tokens = text.match(TRANSLATION_PLACEHOLDER) ?? []; return tokens.length ? `中文${tokens.join("中文")}中文` : "中文译文"; };
function translatedWorkspace(w: Workspace): Workspace {
  const { source, sourceVersion } = documentTranslationSource(w.document)!;
  return { ...w, readingSide: "translated", webTranslation: { version: TRANSLATION_CONTRACT_VERSION, id: "translation-1", target: "zh", documentId: w.document.id, sourceVersion, status: "complete", modelConfig: translationModelConfig(), units: Object.fromEntries(source.units.map(u => [u.id, fakeTranslation(u.text)])), updatedAt: "2026-10-17T00:00:00.000Z" } };
}

describe("Markdown translation source", () => {
  it("builds units from local Markdown without sending code, link targets or images", async () => {
    const w = await markdownWorkspace();
    const ts = documentTranslationSource(w.document)!;
    expect(ts.kind).toBe("markdown");
    expect(ts.sourceVersion).toMatch(/^[a-f0-9]{64}$/);
    const sent = ts.source.units.map(u => u.text).join("\n");
    expect(ts.source.units.length).toBeGreaterThanOrEqual(3);
    expect(sent).toContain("The first paragraph explains");
    for (const hidden of ["inline code", "https://example.com/page", "images/garage.jpg", "const untouched"]) expect(sent).not.toContain(hidden);
  });
  it("changes the source version whenever the original text changes", async () => {
    expect(markdownTranslationVersion(markdown)).toBe(markdownTranslationVersion(markdown));
    expect(markdownTranslationVersion(markdown)).not.toBe(markdownTranslationVersion(markdown + "\nOne more line."));
  });
  it("has no source for PDF documents yet", () => {
    expect(documentTranslationSource({ id: "pdf", kind: "pdf", filename: "a.pdf", contentHash: "a".repeat(64), isDemo: false, importedAt: "2026", pdf: { resourceId: "a".repeat(64), pages: [{ view: [0, 0, 612, 792], rotation: 0 }] } } as never)).toBeNull();
  });
});

describe("Markdown translation persistence and rendering", () => {
  it("keeps a valid Markdown translation and drops one made for a different original", async () => {
    const w = translatedWorkspace(await markdownWorkspace());
    expect(sanitizeWorkspace(w).webTranslation?.id).toBe("translation-1");
    const changed = await markdownWorkspace(markdown + "\nAn edited ending paragraph that changes the original text.");
    const stale = { ...changed, readingSide: "translated" as const, webTranslation: w.webTranslation };
    expect(sanitizeWorkspace(stale).webTranslation).toBeUndefined();
  });
  it("keeps block ids aligned with the reading view around HTML media and noscript blocks", async () => {
    const text = "# T\n\nFirst paragraph here for the reader.\n\n<video controls><p>Fallback text inside video.</p></video>\n\n<video controls>\n<p>Multi-line video fallback.</p>\n</video>\n\n<audio>\n<p>Audio fallback text.</p>\n</audio>\n\n<noscript><p>Noscript text.</p></noscript>\n\nLast paragraph after media for the reader.\n";
    const w = await markdownWorkspace(text);
    const view = Array.from(new DOMParser().parseFromString(translatedRendering({ ...w, readingSide: "original" }).html, "text/html").querySelectorAll<HTMLElement>("[data-block-id]"), n => n.dataset.blockId);
    expect(documentTranslationSource(w.document)!.source.blocks.map(b => b.id)).toEqual(view);
  });
  it("renders the translated view with the same blocks and the local image rules of the original", async () => {
    const w = translatedWorkspace(await markdownWorkspace());
    const images = { "images/garage.jpg": "data:image/png;base64,AAAA" };
    const original = translatedRendering({ ...w, readingSide: "original" }, images);
    const translated = translatedRendering(w, images);
    const ids = (html: string) => Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll<HTMLElement>("[data-block-id]"), n => n.dataset.blockId);
    expect(ids(translated.html)).toEqual(ids(original.html));
    expect(translated.html).toContain("中文");
    expect(translated.html).toContain("data:image/png;base64,AAAA");
    expect(translated.html).toContain("const untouched");
    expect(translated.html).toContain("https://example.com/page");
  });
});

describe("PDF translation persistence", () => {
  const resourceId = "c".repeat(64);
  const pdfWorkspace = (units: Record<string, string>, sourceVersion = pdfTranslationVersion(resourceId)): Workspace => ({
    document: { id: "pdf-doc", kind: "pdf", filename: "a.pdf", contentHash: resourceId, isDemo: false, importedAt: "2026-10-17T00:00:00.000Z", pdf: { resourceId, pages: [{ view: [0, 0, 612, 792], rotation: 0 }, { view: [0, 0, 612, 792], rotation: 0 }] } },
    readingSide: "translated", inquiries: [], activeInquiryId: null, activeProviderId: "codex", updatedAt: "2026-10-17T00:00:00.000Z", hasUnexportedChanges: false,
    webTranslation: { version: TRANSLATION_CONTRACT_VERSION, id: "pdf-translation", target: "zh", documentId: "pdf-doc", sourceVersion, status: "partial", modelConfig: translationModelConfig(), units, updatedAt: "2026-10-17T00:00:00.000Z" },
  } as never);
  it("keeps a PDF translation whose units belong to existing pages of the same file", () => {
    expect(sanitizeWorkspace(pdfWorkspace({ "pdf-p1-b0--v2-part0": "第一页译文", "pdf-p2-b3--v2-part0": "第二页译文" })).webTranslation?.id).toBe("pdf-translation");
  });
  it("keeps a completed PDF translation complete across saves", () => {
    const w = pdfWorkspace({ "pdf-p1-b0--v2-part0": "第一页译文" });
    expect(sanitizeWorkspace({ ...w, webTranslation: { ...w.webTranslation!, status: "complete" } }).webTranslation?.status).toBe("complete");
  });
  it("drops PDF translations for another file, unknown pages or foreign unit ids", () => {
    expect(sanitizeWorkspace(pdfWorkspace({ "pdf-p1-b0--v2-part0": "译文" }, pdfTranslationVersion("d".repeat(64)))).webTranslation).toBeUndefined();
    expect(sanitizeWorkspace(pdfWorkspace({ "pdf-p3-b0--v2-part0": "译文" })).webTranslation).toBeUndefined();
    expect(sanitizeWorkspace(pdfWorkspace({ "block-1-abc--v2-part0": "译文" })).webTranslation).toBeUndefined();
  });
});
