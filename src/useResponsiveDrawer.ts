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
  const close = (restoreFocus = false) => {
    if (narrow && open && (restoreFocus || panel.current?.contains(document.activeElement))) triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
  };
  return { open, setOpen, close, triggerRef };
}
