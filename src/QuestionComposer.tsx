import { useState } from 'react';
import { ArrowUp, MessageCircle } from 'lucide-react';

/** A deliberate, optional input; opening it never invokes a model. */
export function QuestionComposer({ onSubmit, disabled = false, followUp = false, inline = false, prompt, initialOpen = false, onClose }: {
  onSubmit: (question: string) => void; disabled?: boolean; followUp?: boolean; inline?: boolean; prompt?: string; initialOpen?: boolean; onClose?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen), [question, setQuestion] = useState('');
  if (!open) return <>{prompt ? <span className="question-prompt">{prompt}</span> : null}<button className={`question-toggle${inline ? ' question-input-trigger' : ' secondary-action'}`} type="button" disabled={disabled} onClick={() => setOpen(true)}>{inline ? <><MessageCircle size={14} aria-hidden="true"/><span>问一问</span></> : followUp ? '继续追问…' : '问一问'}</button></>;
  const input = <textarea autoFocus aria-label={followUp ? '追问内容' : '自定义问题'} maxLength={2000} rows={inline ? 1 : 3} value={question} onChange={e => {
    setQuestion(e.target.value);
    if (inline) { e.currentTarget.style.height = '32px'; e.currentTarget.style.height = `${Math.min(120, e.currentTarget.scrollHeight)}px`; }
  }} placeholder={inline ? '输入想问的问题' : undefined} onKeyDown={e => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); onClose?.(); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
  }}/>;
  return <form className={`question-composer${inline ? ' question-inline' : ''}`} onSubmit={event => {
    event.preventDefault();
    if (disabled || !question.trim()) return;
    onSubmit(question.trim()); setQuestion(''); setOpen(false); onClose?.();
  }}>
    {inline ? <><button className="question-back" type="button" onClick={() => { setOpen(false); onClose?.(); }}>返回</button>{input}<button className="question-send" type="submit" aria-label="发送问题" title="发送问题（Enter）；Shift+Enter 换行，Esc 返回" disabled={disabled || !question.trim()}><ArrowUp size={19} strokeWidth={2.5} aria-hidden="true" /></button></> : <>
      {followUp ? <label>继续问这个问题{input}</label> : input}
      <div className="question-composer-actions"><button type="button" onClick={() => { setOpen(false); onClose?.(); }}>取消</button><button type="submit" title="Enter 发送；Shift+Enter 换行" disabled={disabled || !question.trim()}>发送问题</button></div>
    </>}
  </form>;
}
