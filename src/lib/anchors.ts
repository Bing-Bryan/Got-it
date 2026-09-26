import { sameAnchor } from "./inquiry-tabs";
import { INTENT_META, NEW_INQUIRY_INTENTS } from "../types";
import type { Anchor, Inquiry, SelectionDraft } from "../types";

/** The amount of source text kept on either side of a selection. */
export const DEFAULT_CONTEXT_LENGTH = 48;

export type AnchorResolutionMethod = "exact-position" | "unique-quote" | "context";

export interface AnchorResolution {
  start: number;
  end: number;
  method: AnchorResolutionMethod;
}

export interface CreateAnchorInput {
  documentId: string;
  blockId: string;
  headingPath?: readonly string[];
  blockText: string;
  start: number;
  end: number;
  contextLength?: number;
}

export type AnchorCreationResult = SelectionDraft | { error: string };

type TextNode = globalThis.Text;

const BLOCK_SELECTOR =
  "[data-block-id], [data-block], h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th";

/**
 * Create a portable anchor from offsets into one rendered semantic block.
 *
 * The offsets are intentionally block-relative. This lets the renderer change
 * its surrounding DOM without invalidating a selection as long as the block's
 * text remains available.
 */
export function createAnchor(input: CreateAnchorInput): Anchor | null {
  const { blockText, start, end } = input;
  if (
    typeof blockText !== "string" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > blockText.length ||
    blockText.slice(start, end).length === 0
  ) {
    return null;
  }

  const contextLength = Math.max(
    0,
    Math.floor(input.contextLength ?? DEFAULT_CONTEXT_LENGTH),
  );

  return {
    textVersion: 2,
    documentId: input.documentId,
    blockId: input.blockId,
    headingPath: [...(input.headingPath ?? [])],
    quote: blockText.slice(start, end),
    prefix: blockText.slice(Math.max(0, start - contextLength), start),
    suffix: blockText.slice(end, Math.min(blockText.length, end + contextLength)),
    start,
    end,
    matchStatus: "matched",
  };
}

/** The text around an anchor, useful for sending compact context to a provider. */
export function getAnchorContext(anchor: Pick<Anchor, "prefix" | "quote" | "suffix">): string {
  return `${anchor.prefix}${anchor.quote}${anchor.suffix}`;
}

function findOccurrences(text: string, needle: string): number[] {
  if (!needle) return [];
  const occurrences: number[] = [];
  let cursor = 0;
  while (cursor <= text.length - needle.length) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) break;
    occurrences.push(index);
    // Move by one to also handle overlapping repetitions such as "aaaa"/"aa".
    cursor = index + 1;
  }
  return occurrences;
}

function commonSuffixLength(left: string, right: string): number {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }
  return length;
}

function commonPrefixLength(left: string, right: string): number {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) {
    length += 1;
  }
  return length;
}

function contextScore(text: string, start: number, end: number, anchor: Anchor): number {
  let score = 0;
  if (anchor.prefix) {
    const before = text.slice(0, start);
    if (before.endsWith(anchor.prefix)) score += 10_000;
    score += commonSuffixLength(before, anchor.prefix);
  }
  if (anchor.suffix) {
    const after = text.slice(end);
    if (after.startsWith(anchor.suffix)) score += 10_000;
    score += commonPrefixLength(after, anchor.suffix);
  }
  return score;
}

interface ContextCandidate {
  start: number;
  end: number;
  score: number;
}

/**
 * Find a changed quote using its surrounding context. The method is deliberately
 * conservative: a tied best context is considered ambiguous and is not guessed.
 */
function findContextCandidates(text: string, anchor: Anchor): ContextCandidate[] {
  if (!anchor.prefix || !anchor.suffix) return [];

  const prefixOccurrences = findOccurrences(text, anchor.prefix);
  const suffixOccurrences = findOccurrences(text, anchor.suffix);
  const candidates: ContextCandidate[] = [];
  const maxGap = Math.max(512, anchor.quote.length * 4 + 128);

  for (const prefixStart of prefixOccurrences) {
    const start = prefixStart + anchor.prefix.length;
    for (const suffixStart of suffixOccurrences) {
      if (suffixStart <= start || suffixStart - start > maxGap) continue;
      candidates.push({
        start,
        end: suffixStart,
        score: contextScore(text, start, suffixStart, anchor),
      });
    }
  }

  return candidates;
}

function chooseUniqueBest(candidates: ContextCandidate[]): ContextCandidate | null {
  if (candidates.length === 0) return null;
  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  const best = candidates.filter((candidate) => candidate.score === bestScore);
  return best.length === 1 ? best[0] : null;
}

/**
 * Resolve an anchor against the current text of its block.
 *
 * Resolution order is intentionally predictable:
 * 1. the saved position when the quote still matches there;
 * 2. a unique occurrence of the quote;
 * 3. a unique best match by prefix/suffix context (including a slightly
 *    changed quote bounded by the same context).
 */
export function resolveAnchorDetailed(blockText: string, anchor: Anchor): AnchorResolution | null {
  if (typeof blockText !== "string" || !anchor.quote) return null;

  if (
    Number.isInteger(anchor.start) &&
    Number.isInteger(anchor.end) &&
    anchor.start >= 0 &&
    anchor.end > anchor.start &&
    anchor.end <= blockText.length &&
    blockText.slice(anchor.start, anchor.end) === anchor.quote
  ) {
    return { start: anchor.start, end: anchor.end, method: "exact-position" };
  }

  const occurrences = findOccurrences(blockText, anchor.quote);
  if (occurrences.length === 1) {
    return {
      start: occurrences[0],
      end: occurrences[0] + anchor.quote.length,
      method: "unique-quote",
    };
  }

  if (occurrences.length > 1) {
    const scored = occurrences.map((start) => ({
      start,
      end: start + anchor.quote.length,
      score: contextScore(blockText, start, start + anchor.quote.length, anchor),
    }));
    const best = chooseUniqueBest(scored);
    if (best && best.score > 0) {
      return { start: best.start, end: best.end, method: "context" };
    }
  }

  // The selected wording may have been edited. If its saved prefix and suffix
  // still form one unambiguous window, recover the changed span conservatively.
  const contextMatch = chooseUniqueBest(findContextCandidates(blockText, anchor));
  if (contextMatch && contextMatch.score > 0) {
    return { start: contextMatch.start, end: contextMatch.end, method: "context" };
  }

  return null;
}

/** Compact resolver used by the reader when it only needs a text range. */
export function resolveAnchor(blockText: string, anchor: Anchor): { start: number; end: number } | null {
  const resolved = resolveAnchorDetailed(blockText, anchor);
  return resolved ? { start: resolved.start, end: resolved.end } : null;
}

/** Return a copy whose status reflects whether it can be restored in blockText. */
export function restoreAnchor(blockText: string, anchor: Anchor): Anchor {
  const resolved = resolveAnchorDetailed(blockText, anchor);
  return resolved
    ? { ...anchor, start: resolved.start, end: resolved.end, matchStatus: "matched" }
    : { ...anchor, matchStatus: "needs-relink" };
}

function nodeTextLength(node: Node): number {
  if (node.nodeType === 3) return (node.nodeValue ?? "").length;
  let length = 0;
  node.childNodes.forEach((child) => {
    length += nodeTextLength(child);
  });
  return length;
}

function isDescendant(root: Node, node: Node): boolean {
  return root === node || root.contains(node);
}

/** Convert a DOM boundary point into a textContent-relative offset. */
function textOffset(root: Node, container: Node, offset: number): number | null {
  if (!isDescendant(root, container)) return null;

  let total = 0;
  if (container.nodeType === 3) {
    total += Math.max(0, Math.min(offset, (container.nodeValue ?? "").length));
  } else {
    const childOffset = Math.max(0, Math.min(offset, container.childNodes.length));
    for (let index = 0; index < childOffset; index += 1) {
      total += nodeTextLength(container.childNodes[index]);
    }
  }

  let current: Node = container;
  while (current !== root) {
    const parent = current.parentNode;
    if (!parent) return null;
    for (const sibling of Array.from(parent.childNodes)) {
      if (sibling === current) break;
      total += nodeTextLength(sibling);
    }
    current = parent;
  }
  return total;
}

function fnv1a(text: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
}

function blockElements(article: HTMLElement): HTMLElement[] {
  const elements = Array.from(article.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  if (article.matches(BLOCK_SELECTOR)) elements.unshift(article);
  return elements;
}

function blockForNode(node: Node, article: HTMLElement): HTMLElement | null {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!element || !article.contains(element)) return null;
  const explicit = element.closest<HTMLElement>('[data-block-id], [data-block]');
  if (explicit && article.contains(explicit)) return explicit;
  const semantic = element.closest<HTMLElement>(
    "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th",
  );
  if (semantic && article.contains(semantic)) return semantic;

  let current: HTMLElement = element as HTMLElement;
  while (current.parentElement && current.parentElement !== article) {
    current = current.parentElement;
  }
  return article.contains(current) ? current : null;
}

function blockId(block: HTMLElement, article: HTMLElement): string {
  const explicit = block.dataset.blockId || block.dataset.block;
  if (explicit) return explicit;
  if (block.id) return block.id;
  const blocks = blockElements(article);
  const ordinal = Math.max(0, blocks.indexOf(block));
  return `block-${ordinal + 1}-${fnv1a(block.textContent ?? "")}`;
}

function headingPath(block: HTMLElement): string[] {
  const value = block.dataset.headingPath;
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // A renderer may use a simple delimiter rather than JSON.
  }
  return value
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectionRect(selection: Selection, range: Range): SelectionDraft["rect"] {
  const rect = range.getBoundingClientRect?.();
  return {
    top: Number.isFinite(rect?.top) ? rect.top : 0,
    left: Number.isFinite(rect?.left) ? rect.left : 0,
    width: Number.isFinite(rect?.width) ? rect.width : 0,
    height: Number.isFinite(rect?.height) ? rect.height : 0,
  };
}

/**
 * Convert the browser's current selection into the same shape used by the UI.
 * Selections crossing semantic blocks are rejected so a thread always has one
 * stable, understandable anchor.
 */
export function createAnchorFromSelection(
  selection: Selection | null,
  article: HTMLElement,
  documentId: string,
): AnchorCreationResult {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { error: "请先选中原文中的一段文字。" };
  }

  const range = selection.getRangeAt(0);
  const startBlock = blockForNode(range.startContainer, article);
  const endBlock = blockForNode(range.endContainer, article);
  if (!startBlock || !endBlock) {
    return { error: "选区不在当前文档中。" };
  }
  if (startBlock !== endBlock) {
    return { error: "请将选区限制在同一段或同一表格单元格内。" };
  }

  const blockText = startBlock.textContent ?? "";
  const start = textOffset(startBlock, range.startContainer, range.startOffset);
  const end = textOffset(startBlock, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) {
    return { error: "无法读取这段选区，请重新选择。" };
  }

  const anchor = createAnchor({
    documentId,
    blockId: blockId(startBlock, article),
    headingPath: headingPath(startBlock),
    blockText,
    start,
    end,
  });
  if (!anchor) return { error: "无法创建原文锚点，请重新选择。" };

  return {
    anchor,
    context: getAnchorContext(anchor),
    rect: selectionRect(selection, range),
  };
}

function findBlock(article: HTMLElement, targetId: string): HTMLElement | null {
  if ((article.dataset.blockId || article.dataset.block || article.id) === targetId) {
    return article;
  }
  return blockElements(article).find((block) => blockId(block, article) === targetId) ?? null;
}

function textNodes(root: Node): TextNode[] {
  const nodes: TextNode[] = [];
  const walker = root.ownerDocument?.createTreeWalker(root, 4);
  if (!walker) return nodes;
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as TextNode);
    current = walker.nextNode();
  }
  return nodes;
}

function boundaryForOffset(root: HTMLElement, offset: number): { node: TextNode; offset: number } | null {
  let remaining = offset;
  for (const node of textNodes(root)) {
    const length = node.data.length;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  const nodes = textNodes(root);
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.data.length } : null;
}

function clearHighlightMarks(article: HTMLElement): void {
  const marks = Array.from(article.querySelectorAll<HTMLElement>("mark[data-focus-stickies-highlight]"));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
  }
  article.normalize();
}

/** Remove highlights previously applied by applyInquiryHighlights. */
export function clearInquiryHighlights(article: HTMLElement): void {
  clearHighlightMarks(article);
}

/** Find an existing rendered mark, including a shared anchor's representative. */
export function findInquiryHighlight(article: HTMLElement, inquiries: readonly Inquiry[], inquiryId: string | null): HTMLElement | null {
  const inquiry = inquiries.find(item => item.id === inquiryId);
  if (!inquiry) return null;
  return Array.from(article.querySelectorAll<HTMLElement>("mark[data-focus-stickies-highlight]")).find(mark => {
    if (mark.dataset.inquiryId === inquiry.id) return true;
    const representative = inquiries.find(item => item.id === mark.dataset.inquiryId);
    return representative && sameAnchor(representative.anchor, inquiry.anchor);
  }) ?? null;
}

/** Change visual focus without resolving anchors, changing threads or saving data. */
export function emphasizeInquiryHighlight(article: HTMLElement, inquiries: readonly Inquiry[], inquiryId: string | null): void {
  const target = findInquiryHighlight(article, inquiries, inquiryId);
  article.querySelectorAll<HTMLElement>("mark[data-focus-stickies-highlight]").forEach(mark => {
    mark.classList.toggle("is-emphasized", mark === target);
  });
}

/**
 * Decorate all restorable inquiry anchors in an article. The function returns a
 * cleanup callback so React effects can remove the DOM decoration on unmount.
 */
export function applyInquiryHighlights(
  article: HTMLElement,
  inquiries: readonly Inquiry[],
  activeInquiryId: string | null,
  onMissing?: (inquiry: Inquiry) => void,
  onResolved?: (inquiry: Inquiry) => void,
): () => void {
  clearHighlightMarks(article);

  const highlighted = inquiries.filter((inquiry, index) => !inquiries.some((other, otherIndex) =>
    other.id !== inquiry.id && sameAnchor(other.anchor, inquiry.anchor) &&
    (other.id === activeInquiryId || (inquiry.id !== activeInquiryId && otherIndex < index))));
  for (const inquiry of highlighted) {
    const block = findBlock(article, inquiry.anchor.blockId);
    if (!block) {
      onMissing?.(inquiry);
      continue;
    }
    const resolution = resolveAnchorDetailed(block.textContent ?? "", inquiry.anchor);
    if (!resolution) {
      onMissing?.(inquiry);
      continue;
    }
    onResolved?.(inquiry);
    const start = boundaryForOffset(block, resolution.start);
    const end = boundaryForOffset(block, resolution.end);
    if (!start || !end) {
      onMissing?.(inquiry);
      continue;
    }

    const range = article.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (range.collapsed) {
      onMissing?.(inquiry);
      continue;
    }

    const mark = article.ownerDocument.createElement("mark");
    mark.dataset.focusStickiesHighlight = "true";
    mark.dataset.inquiryId = inquiry.id;
    mark.dataset.intent = inquiry.intent;
    const intents = new Set(inquiries.filter(other => other.id === inquiry.id || sameAnchor(other.anchor, inquiry.anchor)).map(other => other.intent));
    const orderedIntents = [...NEW_INQUIRY_INTENTS, "why" as const].filter(intent => intents.has(intent));
    mark.dataset.intents = orderedIntents.join(" ");
    mark.className = inquiry.id === activeInquiryId ? "focus-stickies-highlight is-active is-emphasized" : "focus-stickies-highlight";
    mark.setAttribute("aria-label", `知识贴（${orderedIntents.map(intent => INTENT_META[intent].label).join("、")}）：${inquiry.question}`);
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  }

  return () => clearHighlightMarks(article);
}
