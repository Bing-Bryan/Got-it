import { useMemo } from 'react';
import type { ThreadMessage } from './types';
import { RETRIEVAL_LABELS, safeSourceUrl } from './lib/evidence';

function identity(url: string) { const parsed = new URL(url); parsed.hash = ''; return parsed.href.replace(/\/$/, ''); }
export function CompactSources({ message, answerHtml }: { message: ThreadMessage; answerHtml: string }) {
  const bodyLinks = useMemo(() => {
    const doc = new DOMParser().parseFromString(answerHtml, 'text/html');
    return new Set([...doc.querySelectorAll('a[href]')].flatMap(a => { const url = safeSourceUrl(a.getAttribute('href') ?? ''); return url ? [identity(url)] : []; }));
  }, [answerHtml]);
  const seen = new Set<string>();
  const sources = (message.sources ?? []).filter(source => {
    const url = safeSourceUrl(source.url), key = url ? identity(url) : source.id;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  const extra = sources.filter(source => { const url = safeSourceUrl(source.url); return !url || !bodyLinks.has(identity(url)); });
  const status = message.search?.status;
  const warning = status === 'failed' ? '资料查找失败，外部信息可能不完整。'
    : message.completion === 'provisional' ? '资料处理中，引用尚未核对。'
    : status === 'not-executed' ? '本轮未搜索，链接仅供参考。' : '';
  const limits = [...new Set((message.sources ?? []).filter(source => source.retrievalStatus !== 'matched').map(source => RETRIEVAL_LABELS[source.retrievalStatus ?? 'not-read']))];
  return <div className="explanation-sources">
    {extra.length ? <nav className="compact-references" aria-label="参考资料">{extra.map(source => {
      const url = safeSourceUrl(source.url);
      return url ? <a key={source.id} href={url} title={`${source.title} · ${new URL(url).hostname}`} target="_blank" rel="noopener noreferrer">{source.publisher || source.title}</a> : <span key={source.id}>{source.title}（链接不可用）</span>;
    })}</nav> : null}
    {warning ? <p className={`reference-limits${status === 'failed' ? ' warning' : ''}`}>{warning}</p> : null}
    {limits.length ? <p className="reference-limits">部分参考资料：{limits.join('；')}。</p> : null}
  </div>;
}
