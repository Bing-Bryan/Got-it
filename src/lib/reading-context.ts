import type { Anchor } from "../types";

/** Bounded article context; a table cell needs its headers and row to be meaningful. */
export function readingContext(article: HTMLElement | null, anchor: Anchor): string {
  const block = [...(article?.querySelectorAll<HTMLElement>("[data-block-id]") ?? [])].find(e => e.dataset.blockId === anchor.blockId);
  if (!block) return `${anchor.prefix}${anchor.quote}${anchor.suffix}`;
  const heading = anchor.headingPath.join(" / ");
  const cell = block.closest("td,th"), row = cell?.closest("tr"), table = cell?.closest("table");
  if (row) {
    const headers = [...(table?.querySelectorAll("thead th") ?? [])].map(e => e.textContent?.trim()).join(" | ");
    const values = [...row.querySelectorAll("td,th")].map(e => e.textContent?.trim()).join(" | ");
    return `章节：${heading}\n表头：${headers.slice(0,800)}\n当前行：${values.slice(0,2200)}`;
  }
  return `章节：${heading}\n原文：${(block.textContent ?? "").slice(Math.max(0,anchor.start-600),anchor.end+600)}`.slice(0,3000);
}
