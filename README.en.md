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

Concept explanations and simplification search when necessary background or current information is missing; sufficient source material is explained directly. Follow-ups retain earlier answers, with actual search and citation-check status shown separately. Model calls still require a network connection. Timeouts and cancellation preserve partial content; retries retain the original mode.

Web-based verification requires an AI connection that supports search. When evidence is insufficient, Got it makes that uncertainty visible rather than treating an AI answer as an established fact.

## From a question back to the text

1. **Open an article.** Import a Markdown or PDF document and start reading.
2. **Select what stops you.** Choose a concept explanation, a background introduction, or a fact check.
3. **Make sense of it beside the text.** Read the answer, request a simpler explanation or example, or inspect the sources.
4. **Keep reading.** Mark the question as understood and return to the article. Save anything worth revisiting as a knowledge card.

Notes remain linked to their original passages and are saved in a local on-disk reading library. Browser storage retains preferences and an emergency recovery cache. Original files are not modified. PDF copies, OCR data and selected image crops are stored alongside the reading records. Legacy `.focus` and complete JSON backups can still be imported; the current UI does not offer an export/download button.

Use the trash icon beside the category count to enter deletion mode. Each card shows an aligned trash icon; click once to change it to a confirmation check, then click again to delete the card and its answers. Escape or the heading trash icon exits deletion mode. Other cards and the original document remain intact.

## PDF reading

Select native text directly, or use “框选内容” for images and scanned or complex passages. Immediately choose explain, verify or introduce; only then does local OCR start. The original crop and auxiliary text go to the model together. Cancel, Escape or a blank-area click clears the draft. Recognition text can be corrected inside the note; a new answer retains the crop and answer history. The sidebar occupies space when revealed on hover, with one pin toggle to keep it open. A single 36px sticky toolbar holds the current page, region selection, inline instructions and save state; controls are not repeated on every page.

The left navigation can collapse, open temporarily on hover at the left edge, or remain pinned. Pages, highlights, answers and learning states survive reopening; cards return to their original page regions.

PDF pages scroll continuously from top to bottom and automatically fit the reading area as the window or sidebar changes. Limits: 50 MiB, 200 pages, no encrypted files; OCR is limited to 60 seconds per region and needs human correction. Crop uploads are PNG, at most 8 MiB and 4096 pixels per side. Image explanations require an image-capable Codex model and are not fact verification. PDF/OCR assets are prepared locally during installation; AI requests still need network access.

PDF records are not portable `.focus`/JSON exports. Back up the complete application data directory with the service stopped. Legacy Markdown backups remain supported; importing Markdown with local relative image files is still a separate gap. See the [delivery and validation record](docs/updates/2026-09-30.md).

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
