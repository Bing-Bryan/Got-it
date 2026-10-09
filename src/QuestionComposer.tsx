import { useState } from 'react';
import { ArrowUp } from 'lucide-react';

/** A deliberate, optional input; opening it never invokes a model. */
export function QuestionComposer({ onSubmit, disabled = false, followUp = false, inline = false }: {
  onSubmit: (question: string) => void; disabled?: boolean; followUp?: boolean; inline?: boolean;
}) {
  const [open, setOpen] = useState(false), [question, setQuestion] = useState('');
  if (!open) return <button className={`question-toggle${inline ? ' question-input-trigger' : ''}`} type="button" disabled={disabled} onClick={() => setOpen(true)}>{inline ? <><span>问一问</span><span className="question-trigger-arrow" aria-hidden="true"><ArrowUp size={16} strokeWidth={2.5} /></span></> : followUp ? '继续追问…' : '自己提问…'}</button>;
  const input = <textarea autoFocus aria-label={followUp ? '追问内容' : '自定义问题'} maxLength={2000} rows={inline ? 1 : 3} value={question} onChange={e => {
    setQuestion(e.target.value);
    if (inline) { e.currentTarget.style.height = '32px'; e.currentTarget.style.height = `${Math.min(120, e.currentTarget.scrollHeight)}px`; }
  }} placeholder={inline ? '输入想问的问题' : '例如：这个价格包含哪些费用？'} onKeyDown={e => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    if (e.key === 'Enter' && (inline ? !e.shiftKey : e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
  }}/>;
  return <form className={`question-composer${inline ? ' question-inline' : ''}`} onSubmit={event => {
    event.preventDefault();
    if (disabled || !question.trim()) return;
    onSubmit(question.trim()); setQuestion(''); setOpen(false);
  }}>
    {inline ? <>{input}<button className="question-send" type="submit" aria-label="发送问题" title="发送问题（Enter）；Shift+Enter 换行，Esc 返回" disabled={disabled || !question.trim()}><ArrowUp size={19} strokeWidth={2.5} aria-hidden="true" /></button></> : <>
      <label>{followUp ? '继续问这个问题' : '关于这处原文，你想了解什么？'}{input}</label>
      <div className="question-composer-actions"><button type="button" onClick={() => setOpen(false)}>取消</button><button type="submit" disabled={disabled || !question.trim()}>发送问题</button></div>
    </>}
  </form>;
}
