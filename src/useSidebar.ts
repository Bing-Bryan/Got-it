import { useEffect, useRef, useState } from 'react';
const KEY = 'got-it.sidebar-pinned.v1';
export function useSidebar() {
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem(KEY) !== 'false'; } catch { return true; } });
  const [peek, setPeek] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia?.('(max-width: 1080px)').matches ?? false);
  const ref = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => { clearTimeout(timer.current); };
  const reveal = () => { cancel(); if (!pinned && !narrow) setPeek(true); };
  const leave = () => { cancel(); timer.current = setTimeout(() => { if (!ref.current?.contains(document.activeElement)) setPeek(false); }, 220); };
  const returnFocus = () => { if(ref.current?.contains(document.activeElement)) requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.sidebar-rail button')?.focus()); };
  const pin = (value: boolean) => { cancel(); setPinned(value); setPeek(!value); try { localStorage.setItem(KEY, String(value)); } catch { /* session state remains usable */ } };
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1080px)');
    const resize = () => { setNarrow(media?.matches ?? false); setPeek(false); };
    media?.addEventListener('change', resize);
    return () => { media?.removeEventListener('change', resize); clearTimeout(timer.current); };
  }, []);
  return { pinned, peek, narrow, ref, reveal, leave, cancel, pin, close: () => { returnFocus(); cancel(); setPeek(false); } };
}
