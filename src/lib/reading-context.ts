import type { Anchor } from "../types";

/** Bounded article context; a table cell needs its headers and row to be meaningful. */
export function readingContext(article: HTMLElement | null, anchor: Anchor): string {
  if(anchor.pdf)return anchor.pdf.context ?? anchor.quote;
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

/** Only explicitly named comparison subjects add bounded local blocks, never the full article. */
export function questionContext(article: HTMLElement | null, anchor: Anchor, question: string): string {
  const base = readingContext(article, anchor);
  if (!article || anchor.pdf) return base;
  const terms = [...new Set(question.match(/[A-Za-z][A-Za-z0-9.\-]{1,50}|[\u4e00-\u9fff]{2,12}/g) ?? [])]
    .filter(t => !anchor.quote.includes(t)).slice(0, 8);
  const blocks = [...article.querySelectorAll<HTMLElement>('[data-block-id]')]
    .filter(b => b.dataset.blockId !== anchor.blockId && terms.some(t => (b.textContent ?? '').toLocaleLowerCase().includes(t.toLocaleLowerCase())))
    .slice(0, 2).map(b => (b.closest('tr')?.textContent ?? b.textContent ?? '').slice(0, 1200));
  return (base + (blocks.length ? '\n问句提及对象的局部原文（未核实）：\n' + blocks.join('\n') : '')).slice(0, 5600);
}
