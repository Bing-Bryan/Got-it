# Got it

[简体中文](README.md) · **English**

**Make sense of it. Keep reading.**

Got it is a local-first Markdown and PDF reader. Select an unfamiliar passage, explain it or find sources beside the original, and keep useful answers linked to the text. Your reading records stay in a local library, ready to reopen.

> **v0.1.0 · Early preview.** Requires a locally installed, signed-in Codex. macOS Apple Silicon has been tested; Windows/Linux remain experimental pending native UI validation. No accounts, cloud sync or collaboration inside Got it.

## See it in action

These screenshots were captured from the latest code on **October 10, 2026**. The Markdown example is an AI companion product analysis; the PDF is WGSN’s report on silver-generation consumers. Only excerpts are shown, and the complete reports are not distributed. Report figures are unverified input, not endorsed conclusions. Markdown answers are previously saved real model responses, not newly generated for this refresh.

### 1. Keep reading in context

Navigate chapters on the left, read in the center, and revisit knowledge cards on the right. Markdown keeps headings, lists and tables; PDFs retain their original layout. Switching documents or reopening an answer does not call a model or change the original file.

![Current Markdown reader with the AI companion report and knowledge cards](docs/images/reading.png)

### 2. Explain an unfamiliar concept or product

Select a term such as CAGR, a product name, or a difficult passage and choose **Explain**. Concepts, people, companies and products share this entry point. Missing background can be searched when needed. Use **Ask** to submit a more specific question.

![A CAGR explanation beside the original passage](docs/images/explain.png)

### 3. Find sources for a claim

Select a claim or figure, find related sources, and inspect the original pages and verification details. **Finding a link does not establish that a claim is true.** Search execution, page access, quotation checks and evidential support are separate states.

![A related source for the market forecast around the selected CAGR](docs/images/sources.png)

### 4. Ask your own question

Ask about the selected passage—for example, recalculate a growth rate from the report’s numbers. Explanations, sources and questions remain separate and can be switched without regenerating answers. Click the excerpt above an answer to return to its original location.

![A specific question and CAGR calculation using the report's figures](docs/images/question.png)

**Ask about the whole document** sits below the My questions list. Short documents use all available text; long documents provide up to 16,000 characters of structure and relevant excerpts, with coverage disclosed. PDFs need sufficient native text; this feature does not automatically run OCR.

### 5. Read and select directly on PDF pages

WGSN’s original case-study page is shown below. PDFs scroll continuously, and the chapter outline supports search and navigation. Collapse the sidebars for more reading space.

![WGSN report with original images, layout and chapter navigation](docs/images/pdf-reading.png)

Select native text directly, or use **Select region** for images, scans and complex layouts. Include the image and necessary captions, then choose Explain, Find sources or Ask. Local recognition and the model request begin only after choosing a function. This screenshot shows the selection menu before an answer is requested.

![A WGSN image and caption selected with the available question actions](docs/images/pdf-selection.png)

### Reading controls

- Pin or collapse either sidebar independently. Drag the right panel to resize it; navigation uses a drawer at ≤1080px and knowledge cards at ≤780px. Mirrored sidebar icons keep one opening control per side.
- Adjust Markdown content width from 50–100% (default 80%), or PDF zoom from 25–400%, using the upper-right reading control. Hover to open it and move away to close; keyboard and touch operation remain available. PDF can reset to automatic fitting. Preferences stay local.
- Wait for **Saved locally** before closing. Reopen to continue reading and revisit cards. Save failures offer retry; conflicting records retain both versions for your choice.
- Delete cards through the category’s trash control and a second confirmation. The original passage and other cards remain intact.
- Opening a question input does not call a model. Enter sends; Shift+Enter adds a line. Stopping, timing out or failing preserves received content and allows retry.

All functions currently default to **GPT-6.1 SOL / medium**. AI settings read the installed Codex model catalog; unavailable configurations are reported rather than silently replaced. Reading-time estimates are computed locally without model calls. See the [latest update and validation scope](docs/updates/2026-10-10-brand-and-reader-ui.md).

## Run locally

Requires **Node.js 24.14.1 / Node 24** and **npm 11.x**. If using nvm, run `nvm install` and `nvm use` first.

```bash
npm ci
npm run build
npm start
```

The browser opens <http://127.0.0.1:8787/>. Keep the terminal running; Ctrl+C stops the service. Use `npm start` for subsequent launches, and reinstall/rebuild after updating the code. Do not install with `--omit=dev`: the local launcher uses `tsx`.

1. Open AI settings and check the Codex connection. If needed, choose Log in to Codex and complete official authorization, or run `codex login` in a terminal.
2. Add a Markdown or PDF file, or try the built-in example.
3. Select a passage or PDF region and choose an action.
4. Wait for the saved status before closing.

Got it does not read, copy or store Codex tokens. On macOS it prefers the Codex.app / ChatGPT.app executable, then `codex` on PATH; `CODEX_CLI_PATH` can override it. See [validation results](docs/release-results.md) for the tested setup.

For development:

```bash
npm run dev
```

The frontend runs at `127.0.0.1:5173` and the API at `127.0.0.1:8787`. Set `BROWSER=none` to suppress automatic opening; PowerShell uses `$env:BROWSER="none"`. Pass environment variables through the launching shell; `.env.example` documents configuration but `.env` is not loaded automatically.

## Storage and privacy

- Markdown snapshots, PDF copies, OCR resources, crops, cards and answers are stored on disk. Original files remain unchanged. Browser storage keeps preferences and emergency recovery data.
- Default data directories: macOS `~/Library/Application Support/Got-it`; Windows `%LOCALAPPDATA%/Got-it`; Linux `$XDG_DATA_HOME/got-it` or `~/.local/share/got-it`. Override with `GOT_IT_DATA_DIR`; run only one service per data directory.
- PDF outlines prefer embedded bookmarks, otherwise extracting headings locally. Saved outlines are restored on reopening; recognition or save failures offer retry.
- OCR runs locally using assets prepared during installation. Image questions send the selected crop and auxiliary text to the model. Selection requests send bounded context; only explicit document-wide questions prepare broader document material.
- **Local storage does not mean offline AI.** Model calls require network access, your own Codex account and available quota. Source checking reads a limited number of public pages without your browser login credentials.
- Local saving is not an off-device backup. Stop the service and back up the complete application data directory for important reading records. Do not clear browser data to resolve a save error.

## Current limitations

- Codex only. One active document at a time; no Word, original-text editing, cloud sync or collaboration.
- PDFs must be unencrypted, at most 50 MiB and 200 pages. Their fixed layout does not reflow like Markdown. Image explanations require an image-capable model.
- OCR covers Simplified Chinese and English, with a 60-second limit per recognition task. Complex layouts, numbers and small text can be misread; return to the original page to check. The current UI does not edit OCR text. Crops are at most 8 MiB with a longest side of 4096 pixels.
- Automatically inferred PDF outlines may omit or misread headings; there is no manual outline editor. Switching materials interrupts generation, and reopening a document without an outline tries again.
- Document-wide questions may not cover every part of a long document. PDFs without sufficient native text report the limitation instead of silently using OCR.
- There is no current backup-download button. PDFs require the full data directory; legacy Focus Stickies, `.focus` and complete JSON workspaces can still be imported. Older app versions cannot read PDF workspaces.
- Markdown relative local images and cross-paragraph selections are not supported. Substantial source changes may require relocating anchors. Browser imports do not receive original file paths; the macOS native picker can establish an association. Source updates require confirmation and retain old versions/cards.
- Existing answers do not imply understanding or verified facts. Cancellation, disconnection and timeouts are not replaced with demo answers.
- **Do not expose the local API to the public internet.** GitHub Pages cannot replace it.

## Development and release checks

```bash
npm test
npm run build
npm run test:release
npm audit --audit-level=high
```

The build includes type checking. Release smoke tests use isolated data to check built assets, API boundaries, missing Codex and restart behavior without model calls. GitHub Actions runs checks on macOS, Linux and Windows; this is distinct from native UI validation.

See the [release checklist](docs/release-checklist.md), [recorded validation](docs/release-results.md), and [security notes](SECURITY.md).

Maintainers use `npm run release:prepare` to create an allowlisted public snapshot, then sync it to the existing public repository while preserving its independent history. Do not push the internal working repository. Snapshots exclude private reading data, internal evidence and development history; review screenshots separately from text scans.

## License

Project code uses the [MIT License](LICENSE). Third-party names, logos and report excerpts appear only to illustrate the product; they imply neither endorsement nor a license to redistribute the underlying third-party material.
