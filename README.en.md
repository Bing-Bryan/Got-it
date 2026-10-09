# Got it

**Make sense of it. Keep reading.**

Understand what stopped you. Get back to the bigger picture.

[简体中文](README.md) · **English**

## Why Got it

AI can produce a long report in minutes. Understanding it still takes time.

While reading a business analysis, research report, or long article, you might encounter an unfamiliar concept, a confusing argument, or a number whose source is unclear. To make sense of it, you copy the passage into an AI app, add some context, and ask for an explanation.

You may get an answer, but that answer now lives in a separate conversation, disconnected from the text. Returning to the article means finding your train of thought again. The next time you read it, you may not remember what you asked—or where the answer went.

Got it keeps that process beside the article: **select what you don't understand, get an explanation or check the evidence, then keep reading.** Save useful explanations as knowledge cards linked to the original passage, ready to revisit later.

## What the MVP does

Got it is an AI reading tool for Markdown articles and original-layout PDFs.

| When you encounter… | Got it helps you… |
| --- | --- |
| An unfamiliar concept or term | Understand it in context, with simple examples. |
| A company, product, or subject you don't recognize | Learn what it is, what it does, and how it relates to the article. |
| A claim or figure with unclear support | Find relevant sources, see how the evidence relates to the claim, and identify remaining gaps. |
| An explanation that still feels difficult | Ask for a shorter explanation or a simple example. |
| An explanation worth keeping | Keep it as a knowledge card linked to the passage, saved with your reading progress. |

Concept explanations and specific questions search when necessary background or current information is missing; sufficient source material is explained directly. Explanations and source results offer a noninteractive “Still unclear?” prompt beside an Ask button. Opening it does not call a model; submitting creates a separate question. Source results no longer show a search-again or answer-history entry; failed or interrupted searches can still be retried. Stored history is preserved. Model calls still require a network connection. Timeouts and cancellation preserve partial content; retries retain the original mode.

Web-based verification requires an AI connection that supports search. When evidence is insufficient, Got it makes that uncertainty visible rather than treating an AI answer as an established fact.

All functions default to **GPT-6.1 SOL / Medium**. The model menu reads the installed Codex catalog and supports explicit refresh. Unavailable target configurations are reported rather than silently replaced. Historical answers keep their original model metadata.

Explain covers concepts, people, organizations and products. Each selected passage can retain separate explanation, source and custom-question results. First opening prefers an existing explanation; later visits remember the last result viewed. The custom-question switch shows only “我的问题” (My questions); individual questions remain accessible from their list.

The right panel resizes from 220–720px. Its header progressively switches from full labels to icons with counts, then icons only. Full labels remain down to 380px and counts down to 240px, with a small buffer when expanding. Drag another 48px beyond the minimum and release to collapse; reopening restores the previous width and draft. Narrow screens use a drawer.

Markdown has a horizontal-arrow icon in the upper-right reading corner for content width (50–100%, default 80%), without changing font size. Code blocks use a light background and the body text size. Markdown and PDF save status stays at the far right, with delayed success feedback to avoid flickering during continuous changes.

The document header estimates reading time locally. PDFs use native text only when coverage is sufficient; this estimate never triggers OCR or an AI request. “向全文提问” (Ask about the whole document) sits below the right-hand My questions list. It uses complete short texts or up to 16,000 characters of structure and relevant excerpts for long documents; PDFs require sufficient native text. Selection-based questions remain scoped to their passage. Enter sends; Shift+Enter adds a line, with input-method composition protected.

## From a question back to the text

1. **Open an article.** Import a Markdown or PDF document and start reading.
2. **Select what stops you.** Choose Explain or Find sources, or open Ask to enter a specific question.
3. **Make sense of it beside the text.** Read the answer, ask a specific question, or inspect the sources.
4. **Keep reading.** Return to the article or the previous list position without confirming understanding. Answers are saved with their original passages.

Notes remain linked to their original passages and are saved in a local on-disk reading library. Browser storage retains preferences and an emergency recovery cache. Original files are not modified. PDF copies, OCR data and selected image crops are stored alongside the reading records. Legacy `.focus` and complete JSON backups can still be imported; the current UI does not offer an export/download button.

When two different, unresolved reading records exist, a short dialog describes the differences and lets you choose which to continue. Identical, single or already-resolved records do not prompt. Clicking outside or pressing Escape dismisses the dialog for this reading visit; reopening the article reminds you of unresolved differences. The other record stays safely stored without a permanent history panel.

Use the trash icon beside the category count to enter deletion mode. Each card shows an aligned trash icon; click once to change it to a confirmation check, then click again to delete the card and its answers. Escape or the heading trash icon exits deletion mode. Other cards and the original document remain intact.

## PDF reading

Select native text directly, or use “框选内容” for images and scanned or complex passages. Choose Explain, Find sources, or submit a specific question; only then does local OCR start. The original crop and auxiliary text go to the model together. Cancel, Escape or a blank-area click clears the draft. The compact excerpt locates the original page; narrow screens close the answer panel after successful positioning. The separate preview and OCR correction controls have been removed; existing crops, original recognition text and corrections remain saved and are reused for retries. The app fills the window without outer gutters. Both sidebars can be collapsed or pinned independently using mirrored pin controls beside the reading area; pin preferences are saved locally. Edge buttons or hover reveal collapsed sidebars and let automatically fitted PDFs follow the remaining width. Intentionally opened answers stay visible. An unpinned answer panel can be closed with Escape or its bottom-right collapse button, retaining answers and unsent drafts. Narrow screens retain the drawer controls. A single 36px sticky toolbar holds the current page, region selection, inline instructions and right-aligned save state; controls are not repeated on every page.

The left navigation can collapse, open temporarily on hover at the left edge, or remain pinned. Pages, highlights, answers and learning states survive reopening; cards return to their original page regions.

PDF pages scroll continuously and fit the reading area by default. A diagonal-arrow icon in the upper-right corner of the reading area opens a slider and percentage field for continuous zoom from 25% to 400%; manual scale persists through window and sidebar changes and is remembered locally per PDF. The reset icon restores automatic fitting. The same compact icon opens the controls at every screen size; Escape or an outside click closes them. Desktop trackpad zoom events and Ctrl/Command + wheel zoom the original content; ordinary wheel scrolling remains unchanged. Limits: 50 MiB, 200 pages, no encrypted files; OCR is limited to 60 seconds per region and can contain recognition errors. Crop uploads are PNG, at most 8 MiB and 4096 pixels per side. Image explanations require an image-capable Codex model and are not fact verification. PDF/OCR assets are prepared locally during installation; AI requests still need network access.

PDF records are not portable `.focus`/JSON exports. Back up the complete application data directory with the service stopped. Legacy Markdown backups remain supported; importing Markdown with local relative image files is still a separate gap. See the [latest update and validation](docs/updates/2026-10-09-reading-controls.md).

## Run locally

Early preview (v0.1.0). Requires Node.js **24.14.1 / Node 24**, npm **11.x**, and a locally installed, signed-in Codex. macOS Apple Silicon has been tested; Windows/Linux remain experimental pending native UI validation.

```bash
npm ci
npm run build
npm start
```

Keep the terminal open and visit <http://127.0.0.1:8787/>. Do not expose the local API to the public internet. AI requests require network access and your own Codex account; local storage does not mean offline AI.

The [Chinese README](README.md) includes four real screenshots, setup details and known limitations. See the [release checklist](docs/release-checklist.md), [validation results](docs/release-results.md), and [security notes](SECURITY.md). Screenshot report figures are unverified input, not endorsed research conclusions.

Source code is available under the [MIT License](LICENSE).

---

**A place for your questions. More attention for the article.**
