import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

/** Shared hover/focus lifetime; reading values remain owned by each control. */
export function useReadingAdjustment() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false), dragging = useRef(false), keyboard = useRef(true);
  const pointerType = useRef('');
  const cancel = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  const close = () => { cancel(); setOpen(false); };
  const editing = () => {
    const active = document.activeElement;
    return root.current?.contains(active) && (keyboard.current || (active instanceof HTMLInputElement && active.type !== 'range'));
  };
  const deferClose = () => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!hovered.current && !dragging.current && !editing()) setOpen(false);
    }, 180);
  };
  useEffect(() => () => cancel(), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const release = (event: globalThis.PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (event.type === 'pointercancel') hovered.current = false;
      else if (document.elementFromPoint) hovered.current = !!root.current?.contains(document.elementFromPoint(event.clientX, event.clientY));
      deferClose();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('pointerup', release);
      document.removeEventListener('pointercancel', release);
      cancel(); dragging.current = false;
    };
  }, [open]);
  return {
    root, open, close,
    triggerClick: (event: MouseEvent<HTMLButtonElement>) => {
      cancel();
      // A mouse click following hover must not immediately undo the reveal.
      if (event.detail > 0 && pointerType.current === 'mouse') setOpen(true);
      else setOpen(value => !value);
    },
    events: {
      onPointerEnter: (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        hovered.current = true; cancel(); setOpen(true);
      },
      onPointerLeave: () => { hovered.current = false; deferClose(); },
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        pointerType.current = event.pointerType; keyboard.current = false;
        dragging.current = true; cancel();
      },
      onKeyDownCapture: () => { keyboard.current = true; cancel(); },
      onFocus: cancel,
      onBlur: deferClose,
    },
  };
}
