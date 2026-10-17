import {HOSTED} from './lib/runtime-mode';
import {HostedSendDisclosure} from './HostedControls';
import { Lightbulb, ShieldCheck, X } from 'lucide-react';
import { QuestionComposer } from './QuestionComposer';
import type { ReactNode } from 'react';
import type { ActiveInquiryIntent } from './types';

/** Shared selection actions for Markdown text, PDF text and PDF regions. */
export function SelectionActions({ onSelect, onClose, disabled, bookmark, className = '' }: {
  onSelect: (intent: ActiveInquiryIntent, question?: string) => void;
  onClose: () => void;
  disabled?: boolean;
  bookmark?: ReactNode;
  className?: string;
}) {
  return <>{HOSTED?<HostedSendDisclosure compact/>:null}<div className="selection-operation-row">{bookmark?<div className="selection-bookmark-container">{bookmark}</div>:null}<div className={`selection-actions ${className}`}>
    <button type="button" data-intent="explain" disabled={disabled} onClick={() => onSelect('explain')}><Lightbulb size={14} aria-hidden="true"/>解释一下</button>
    <button type="button" data-intent="verify" disabled={disabled} onClick={() => onSelect('verify')}><ShieldCheck size={14} aria-hidden="true"/>查找来源</button>
    <QuestionComposer inline disabled={disabled} onSubmit={question => onSelect('ask', question)}/>
    <button className="selection-close" type="button" aria-label="关闭" title="关闭选区" onClick={onClose}><X size={14} aria-hidden="true"/></button>
  </div></div></>;
}
