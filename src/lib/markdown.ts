import {annotateBookmarkBlocks} from './bookmark-dom';
import {domWebAnchorText} from './web-anchor-compat';
import {missingWebMediaHtml,mediaLegacyAttribute,stripWebCompatAttributes} from './web-media-markup';
import DOMPurify from "dompurify";
import { marked, Renderer } from "marked";
import type { WebDocumentData } from "./web-data";
import type { OutlineItem, RenderedMarkdown } from "../types";
import { stableHash } from "../sample";

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,pre,td,th";

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderMarkdown(markdown: string, web?: WebDocumentData, imageSources?:Record<string,string>): RenderedMarkdown {
  const mediaById = new Map(web?.media.map(media => [media.id, media]));
  const renderer = web ? new Renderer() : undefined;
  if(renderer)renderer.html=({text})=>stripWebCompatAttributes(text);
  if (renderer) renderer.image = ({ href, text }) => {
    const id = href.startsWith("got-it-media:") ? href.slice("got-it-media:".length) : "";
    const media = mediaById.get(id);
    if (!media) return `<span class="image-unavailable">图片未获授权：${escapeHtml(text)}</span>`;
    if (media.status !== "saved") return missingWebMediaHtml(media);
    return `<img${mediaLegacyAttribute(media)} data-web-media="${escapeHtml(media.id)}" tabindex="0" role="button" aria-label="放大查看：${escapeHtml(media.alt || "静态图片或图表")}" alt="${escapeHtml(media.alt)}"${media.width ? ` width="${media.width}"` : ""}${media.height ? ` height="${media.height}"` : ""}>`;
  };
  const rawHtml = marked.parse(markdown, {
    async: false,
    gfm: true,
    breaks: false,
    ...(renderer ? { renderer } : {}),
  }) as string;

  const safeHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
    ...(web ? { FORBID_ATTR: ["src", "srcset", "style"], FORBID_TAGS: ["video", "audio", "iframe", "object", "embed", "source", "svg", "style", "link"] } : {}),
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
    const projection=domWebAnchorText(block);
    const blockId = `block-${index}-${stableHash(`${tagName}:${cleanText(projection.legacy?.text??text)}`).slice(0, 7)}`;
    if(projection.legacy)block.dataset.webAnchorLegacy=JSON.stringify(projection.legacy);
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
    if (web) {
      const media = mediaById.get(img.dataset.webMedia ?? "");
      img.removeAttribute("src"); img.removeAttribute("srcset");
      if (media?.status === "saved") { img.classList.add("web-static-image"); return; }
      const notice = document.createElement("span"); notice.className = "image-unavailable"; notice.textContent = "图片未获本机资源授权。"; img.replaceWith(notice); return;
    }
    applyLocalDocumentImage(img, imageSources);
  });

  if (web) container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => {
    let fragment: string; try { fragment = decodeURIComponent(link.hash.slice(1)); } catch { return; }
    const match = web.fragments.find(item => item.fragment === fragment);
    if (match && outline[match.headingIndex]) link.href = `#${outline[match.headingIndex].id}`;
  });
  annotateBookmarkBlocks(container);
  container.querySelectorAll<HTMLElement>('[data-web-anchor-legacy]').forEach(block=>{const p=domWebAnchorText(block);if(p.legacy)block.dataset.webAnchorLegacy=JSON.stringify(p.legacy);});
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

// Local Markdown images: sample images map to their stored copies; anything that is not an
// http(s) or inline image is replaced by a notice. Shared by the original and translated views.
function applyLocalDocumentImage(img: HTMLImageElement, imageSources?: Record<string, string>) {
  let src = img.getAttribute("src") ?? "";
  if (imageSources?.[src]) { src = imageSources[src]; img.setAttribute("src", src); }
  if (!/^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src)) {
    const notice = document.createElement("span");
    notice.className = "image-unavailable";
    notice.textContent = `图片未随文档导入：${img.alt || src || "未命名图片"}。请在原文件中查看。`;
    img.replaceWith(notice);
  }
}
export function applyLocalDocumentImages(container: ParentNode, imageSources?: Record<string, string>) {
  container.querySelectorAll<HTMLImageElement>("img").forEach(img => applyLocalDocumentImage(img, imageSources));
}

