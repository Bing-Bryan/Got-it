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

Got it is an AI reading tool built around Markdown articles.

| When you encounter… | Got it helps you… |
| --- | --- |
| An unfamiliar concept or term | Understand it in context, with simple examples. |
| A company, product, or subject you don't recognize | Learn what it is, what it does, and how it relates to the article. |
| A claim or figure with unclear support | Find relevant sources, see how the evidence relates to the claim, and identify remaining gaps. |
| An explanation that still feels difficult | Ask for a shorter explanation or a simple example. |
| An explanation worth keeping | Keep it as a knowledge card linked to the passage, saved with your reading progress. |

Web-based verification requires an AI connection that supports search. When evidence is insufficient, Got it makes that uncertainty visible rather than treating an AI answer as an established fact.

## From a question back to the text

1. **Open an article.** Import a Markdown document and start reading.
2. **Select what stops you.** Choose a concept explanation, a background introduction, or a fact check.
3. **Make sense of it beside the text.** Read the answer, request a simpler explanation or example, or inspect the sources.
4. **Keep reading.** Mark the question as understood and return to the article. Save anything worth revisiting as a knowledge card.

Notes remain linked to their original passages and are saved in a local on-disk reading library. Browser storage retains preferences and an emergency recovery cache. The original Markdown file is not modified. Legacy `.focus` and complete JSON backups can still be imported; the current UI does not offer an export/download button.

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
