/** Scroll only inside the reader; sticky PDF tools are excluded from its viewport. */
export function revealReadingTarget(target: HTMLElement, options: { align?: "start" } = {}): boolean {
  const scroll = target.closest<HTMLElement>('.reader-scroll,.recovery-original');
  if (!scroll) return false;
  const bounds = scroll.getBoundingClientRect();
  const tools = scroll.querySelector<HTMLElement>('.pdf-toolbar')?.getBoundingClientRect();
  const top = Math.max(bounds.top, tools?.bottom ?? bounds.top) + 24;
  const bottom = bounds.bottom - 8;
  const rect = target.getBoundingClientRect();
  const height = bottom - top;
  if (height <= 0) return false;
  const delta = options.align === "start" || rect.top < top ? rect.top - top
    : rect.height > height ? (rect.top >= bottom ? rect.top - top : 0)
    : rect.bottom > bottom ? rect.bottom - bottom : 0;
  const horizontal = rect.left < bounds.left + 8 ? rect.left - bounds.left - 8
    : rect.right > bounds.right - 8 ? (rect.width > bounds.width - 16 ? rect.left - bounds.left - 8 : rect.right - bounds.right + 8) : 0;
  if (delta || horizontal) {
    if (typeof scroll.scrollTo === 'function') scroll.scrollTo({top:scroll.scrollTop+delta,left:scroll.scrollLeft+horizontal,behavior:'instant'});
    else { scroll.scrollTop += delta; scroll.scrollLeft += horizontal; }
  }
  return true;
}

export function focusReadingTarget(target: HTMLElement): void {
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
