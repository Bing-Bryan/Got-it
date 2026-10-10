import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Temporary drawers never carry their open state across a desktop breakpoint. */
export function useResponsiveDrawer({ narrow, panel, desktopExpanded, desktopTrigger, desktopControl }: {
  narrow: boolean;
  panel: RefObject<HTMLElement | null>;
  desktopExpanded: boolean;
  desktopTrigger: string;
  desktopControl: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousNarrow = useRef(narrow);
  const restoreOnClose = useRef(false);
  // CSS can hide and blur a control before React observes the media change.
  const lastFocused = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const focus = (event: FocusEvent) => { lastFocused.current = event.target instanceof Element ? event.target : null; };
    const pointer = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) lastFocused.current = null;
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('pointerdown', pointer);
    return () => { document.removeEventListener('focusin', focus); document.removeEventListener('pointerdown', pointer); };
  }, [panel]);
  useLayoutEffect(() => {
    if (previousNarrow.current === narrow) return;
    previousNarrow.current = narrow;
    setOpen(false);
    const active = document.activeElement === document.body ? lastFocused.current : document.activeElement;
    const hiddenTrigger = narrow ? document.querySelector(desktopTrigger) === active : triggerRef.current === active;
    const hiddenPanelFocus = panel.current?.contains(active) && (narrow || !desktopExpanded);
    if (hiddenTrigger || hiddenPanelFocus) {
      const target = narrow ? triggerRef.current : document.querySelector<HTMLButtonElement>(desktopExpanded ? desktopControl : desktopTrigger);
      target?.focus({ preventScroll: true });
    }
  }, [narrow, desktopExpanded, panel, desktopTrigger, desktopControl]);
  useLayoutEffect(() => {
    if (!narrow || !open || !panel.current) {
      if (restoreOnClose.current) { restoreOnClose.current = false; triggerRef.current?.focus({ preventScroll: true }); }
      return;
    }
    const element = panel.current;
    const controls = () => [...element.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(node => {
      for (let current: HTMLElement | null = node; current && current !== element; current = current.parentElement) {
        if (current.hidden || current.hasAttribute('inert') || getComputedStyle(current).display === 'none' || getComputedStyle(current).visibility === 'hidden') return false;
      }
      return true;
    });
    const focusFirst = () => controls()[0]?.focus({ preventScroll: true });
    if (!element.contains(document.activeElement)) focusFirst();
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (!element.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    };
    const focus = (event: FocusEvent) => {
      if (!element.contains(event.target as Node) && !document.querySelector('dialog[open]')) focusFirst();
    };
    document.addEventListener('keydown', key); document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('focusin', focus); };
  }, [narrow, open, panel]);
  const close = (restoreFocus = false) => {
    if (narrow && open && (restoreFocus || panel.current?.contains(document.activeElement))) restoreOnClose.current = true;
    setOpen(false);
  };
  return { open, setOpen, close, triggerRef };
}
