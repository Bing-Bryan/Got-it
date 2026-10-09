import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'got-it.result-panel-pinned.v1';
const MEDIA = '(max-width: 780px)';
type Mode = 'closed' | 'peek' | 'reading';

/** Visibility only: hiding the panel never unmounts or changes a reading thread. */
export function useResultPanel() {
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem(KEY) !== 'false'; } catch { return true; }
  });
  const [mode, setMode] = useState<Mode>('closed');
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(MEDIA).matches ?? false);
  const ref = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hovered = useRef(false);
  const hoverBlockedUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => { clearTimeout(timer.current); }, []);
  const enter = useCallback(() => { hovered.current = true; cancel(); }, [cancel]);
  const reveal = useCallback(() => {
    cancel();
    setMode(current => current === 'reading' ? current : 'peek');
  }, [cancel]);
  const hoverReveal = useCallback(() => {
    // Closing under the pointer must not immediately reopen the new edge rail.
    if (Date.now() >= hoverBlockedUntil.current) reveal();
  }, [reveal]);
  const openReading = useCallback(() => { cancel(); setMode('reading'); }, [cancel]);
  const deferClose = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      if (!hovered.current && !ref.current?.contains(document.activeElement)) {
        setMode(current => current === 'peek' ? 'closed' : current);
      }
    }, 220);
  }, [cancel]);
  const leave = useCallback(() => { hovered.current = false; deferClose(); }, [deferClose]);
  const pin = useCallback((value: boolean) => {
    cancel(); setPinned(value); setMode(value ? 'closed' : 'peek');
    try { localStorage.setItem(KEY, String(value)); } catch { /* keep session preference */ }
    if (!value) deferClose();
  }, [cancel, deferClose]);
  const close = useCallback(() => {
    if (pinned) return;
    const restoreFocus = ref.current?.contains(document.activeElement);
    cancel(); setMode('closed'); hovered.current = false;
    hoverBlockedUntil.current = Date.now() + 300;
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, [pinned, cancel]);
  const collapseFromDrag = useCallback(() => {
    cancel(); setPinned(false); setMode('closed'); hovered.current = false;
    hoverBlockedUntil.current = Date.now() + 500;
    try { localStorage.setItem(KEY, 'false'); } catch { /* retain session state */ }
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [cancel]);
  useEffect(() => {
    const media = window.matchMedia?.(MEDIA);
    const resize = () => { cancel(); hovered.current = false; setNarrow(media?.matches ?? false); setMode('closed'); };
    media?.addEventListener('change', resize);
    resize(); // Reconcile a viewport change between initial render and subscribing.
    return () => { media?.removeEventListener('change', resize); cancel(); };
  }, [cancel]);
  return { pinned, expanded: pinned || mode !== 'closed', narrow, ref, triggerRef, enter, leave, deferClose, cancel, reveal, hoverReveal, openReading, pin, close, collapseFromDrag };
}
