import DOMPurify from "dompurify";
import { marked } from "marked";
import type { OutlineItem, RenderedMarkdown } from "../types";
import { stableHash } from "../sample";

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,pre,td,th";

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function renderMarkdown(markdown: string): RenderedMarkdown {
  const rawHtml = marked.parse(markdown, {
    async: false,
    gfm: true,
    breaks: false,
  }) as string;

  const safeHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
  });

  const container = document.createElement("div");
  container.innerHTML = safeHtml;

  const outline: OutlineItem[] = [];
  const headingStack: string[] = [];
  let headingIndex = 0;

  container.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      link.target = "_blank";
      link.rel = "noreferrer noopener";
    }
  });

  container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR).forEach((block, index) => {
    const text = cleanText(block.textContent);
    const tagName = block.tagName.toLowerCase();
    const blockId = `block-${index}-${stableHash(`${tagName}:${text}`).slice(0, 7)}`;
    block.dataset.blockId = blockId;

    if (/^h[1-6]$/.test(tagName)) {
      const level = Number(tagName.slice(1));
      headingStack.length = level - 1;
      headingStack[level - 1] = text;
      const id = `section-${headingIndex}-${stableHash(text).slice(0, 6)}`;
      headingIndex += 1;
      block.id = id;
      outline.push({ id, text, level });
    }

    block.dataset.headingPath = JSON.stringify(headingStack.filter(Boolean));
  });

  // Keep legacy block ids and visible offsets; source ==markers== no longer add emphasis.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest("code,pre")) continue;
    const matches = [...node.data.matchAll(/==([^=\n]+)==/g)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(node.data.slice(offset, match.index));
      fragment.append(match[1]);
      offset = match.index! + match[0].length;
    }
    fragment.append(node.data.slice(offset));
    node.replaceWith(fragment);
  }
  container.querySelectorAll<HTMLImageElement>("img").forEach(img => {
    const src = img.getAttribute("src") ?? "";
    if (!/^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src)) {
      const notice = document.createElement("span");
      notice.className = "image-unavailable";
      notice.textContent = `图片未随文档导入：${img.alt || src || "未命名图片"}。请在原文件中查看。`;
      img.replaceWith(notice);
    }
  });

  return { html: container.innerHTML, outline };
}

export function getBlockElement(node: Node | null): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  return element?.closest<HTMLElement>("[data-block-id]") ?? null;
}

export function readHeadingPath(block: HTMLElement): string[] {
  try {
    const value = JSON.parse(block.dataset.headingPath ?? "[]");
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
  } catch {
    return [];
  }
}
