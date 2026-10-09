/** Scroll only inside the reader; sticky PDF tools are excluded from its viewport. */
export function revealReadingTarget(target: HTMLElement): boolean {
  const scroll = target.closest<HTMLElement>('.reader-scroll,.recovery-original');
  if (!scroll) return false;
  const bounds = scroll.getBoundingClientRect();
  const tools = scroll.querySelector<HTMLElement>('.pdf-toolbar')?.getBoundingClientRect();
  const top = Math.max(bounds.top, tools?.bottom ?? bounds.top) + 8;
  const bottom = bounds.bottom - 8;
  const rect = target.getBoundingClientRect();
  const height = bottom - top;
  if (height <= 0) return false;
  const delta = rect.top < top ? rect.top - top
    : rect.height > height ? (rect.top >= bottom ? rect.top - top : 0)
    : rect.bottom > bottom ? rect.bottom - bottom : 0;
  if (delta) scroll.scrollTop += delta;
  return true;
}

export function focusReadingTarget(target: HTMLElement): void {
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
