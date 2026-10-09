import { useEffect, useState } from 'react';

/** Coalesce short save cycles without delaying writes or error feedback. */
export function useSaveStatus(status: string, identity: string) {
  const [settled, setSettled] = useState({ identity, status });
  useEffect(() => {
    if (status !== '已保存到本机' || settled.identity !== identity) {
      setSettled({ identity, status });
      return;
    }
    const timer = setTimeout(() => setSettled({ identity, status }), 800);
    return () => clearTimeout(timer);
  }, [status, identity, settled.identity]);
  if (status === '保存中…') return '保存中';
  if (status === '已保存到本机' && settled.identity === identity && settled.status !== status) return '保存中';
  return status;
}
