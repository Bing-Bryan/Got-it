import {useEffect, useRef, useState} from 'react';
import {LibraryClientError, libraryRequest} from './lib/library-client';
import {copyOutline, type PdfOutline as Outline, type PdfOutlineItem} from './lib/pdf-outline';
import './pdf-outline.css';

interface Props {entryId:string; fileHash:string; pages:number; query:string; currentPage:number; readOnly?:boolean; onJump:(item:PdfOutlineItem)=>void}
type Failure = {message:string; action:string};
const message = (error:unknown) => error instanceof Error ? error.message : '目录操作失败，请重试。';

export default function PdfOutline({entryId, fileHash, pages, query, currentPage, readOnly, onJump}:Props) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [status, setStatus] = useState('正在读取目录…');
  const [failure, setFailure] = useState<Failure | null>(null);
  const retry = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Each mount/load owns its signal: late work from StrictMode or a previous
    // document must never revive when a later effect starts.
    const controller = new AbortController();
    const {signal} = controller;
    const path = `/entries/${entryId}/outline/${fileHash}`;
    let busy = false;
    setOutline(null);
    retry.current = null;

    function begin(text:string) {
      if (signal.aborted || busy) return false;
      busy = true;
      retry.current = null;
      setFailure(null);
      setStatus(text);
      return true;
    }
    function fail(text:string, action:string, run:() => void) {
      if (signal.aborted) return;
      busy = false;
      setStatus('');
      setFailure({message:text, action});
      retry.current = run;
    }
    async function save(value:Outline) {
      if (!begin('正在保存目录…')) return;
      try {
        const result = await libraryRequest<Outline>(path, value);
        if (signal.aborted) return;
        setOutline(copyOutline(result, fileHash, pages));
        setStatus('');
        busy = false;
      } catch (error) {
        if (error instanceof LibraryClientError && error.status === 409) {
          fail('另一页面已更新目录，请重新载入已保存的目录。', '重新载入目录', () => void load());
        } else {
          fail(`目录暂未保存，当前仍可使用。${message(error)}`, '重试', () => void save(value));
        }
      }
    }
    async function generate(value:Outline) {
      if (!begin('正在准备本机识别目录…')) return;
      try {
        const {generatePdfOutline} = await import('./lib/generate-pdf-outline');
        signal.throwIfAborted();
        const items = await generatePdfOutline(entryId, fileHash, signal, text => {
          if (!signal.aborted) setStatus(text);
        });
        signal.throwIfAborted();
        if (!items.length) throw new Error('未识别到可用的章节标题。');
        const next = {...value, items, reviewed:false};
        setOutline(next);
        busy = false;
        await save(next);
      } catch (error) {
        fail(`目录识别未完成。${message(error)}`, '重新识别', () => void generate(value));
      }
    }
    async function load() {
      if (!begin('正在读取目录…')) return;
      try {
        const result = await libraryRequest<Outline>(path);
        if (signal.aborted) return;
        const value = copyOutline(result, fileHash, pages);
        setOutline(value);
        busy = false;
        if (!value.items.length && !readOnly) await generate(value);
        else setStatus(value.items.length ? '' : '此只读文档暂无章节目录。');
      } catch (error) {
        fail(`目录读取失败。${message(error)}`, '重新载入目录', () => void load());
      }
    }
    void load();
    return () => {controller.abort(); retry.current = null;};
  }, [entryId, fileHash, pages, readOnly]);

  const allItems = outline?.items ?? [];
  const items = allItems.filter(item => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const active = allItems.filter(item => item.page <= currentPage).at(-1)?.id;
  return <div className="pdf-outline" aria-label="PDF 原文章节目录">
    <div className="section-label"><span>原文章节</span><span>{allItems.length} 项 · {pages} 页</span></div>
    {status ? <p className="pdf-outline-note" role="status">{status}</p> : null}
    {failure ? <div className="pdf-outline-error" role="alert">
      <p>{failure.message}</p>
      <button type="button" onClick={() => retry.current?.()}>{failure.action}</button>
    </div> : null}
    <div className="outline-list">{items.map(item => <button type="button" key={item.id}
      className={`outline-item level-${item.level} pdf-outline-item`} aria-current={active === item.id ? 'location' : undefined}
      onClick={() => onJump(item)}><span>{item.title}</span><small>{item.page}</small></button>)}
      {allItems.length > 0 && !items.length ? <p className="nav-empty">没有匹配的目录标题。</p> : null}
    </div>
  </div>;
}
