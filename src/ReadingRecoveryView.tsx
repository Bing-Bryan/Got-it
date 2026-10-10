import { recoveryDiff, describeRecoveryDifference, type RecoveryDifference } from './lib/recovery-diff';
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import type { useReadingLibrary } from './useReadingLibrary';
import { inquiryContent, sameOriginal } from './lib/reading-recovery';
import { renderMarkdown } from './lib/markdown';
import { STATUS_META, INTENT_META, type Inquiry } from './types';

const PdfReader=lazy(()=>import("./PdfReader"));
type Library = ReturnType<typeof useReadingLibrary>;
function Markdown({text}:{text:string}) {
  const html=useMemo(()=>renderMarkdown(text).html,[text]);
  return <div className="answer-markdown" dangerouslySetInnerHTML={{__html:html}} />;
}
const labels:Record<string,string>={explanationMode:'解释模式',id:'编号',title:'标题',url:'链接',domain:'网站',snippet:'摘要',excerpt:'来源片段',excerptKind:'片段类型',retrievalStatus:'引用核对',relation:'与主张的关系',checkedAt:'核对时间',locatable:'可定位原文',websiteRole:'网站角色',publisher:'发布者',publishedAt:'发布时间',origin:'来源类型',reliability:'可靠性',reliabilityReasons:'可靠性依据',scope:'适用范围',differences:'差异',applicability:'适用程度',verdict:'结论',summary:'总结',reason:'理由',readingAdvice:'阅读建议',claims:'具体主张',text:'主张',sourceIds:'关联来源',round:'轮次',parentMessageId:'前轮回答',completion:'完成状态',changeNote:'变化说明'};
const values:Record<string,string>={supported:'支持',partial:'部分支持',conflicting:'存在冲突',insufficient:'证据不足',incomplete:'未完成',quote:'原文引用',summary:'摘要',unverified:'未核对',matched:'匹配',mismatch:'不匹配',unavailable:'无法读取',unsupported:'暂不支持','not-read':'未读取',supports:'支持',conflicts:'冲突',related:'相关',unknown:'未知',official:'官方',reference:'参考',original:'原始',secondary:'二手',strong:'较强',moderate:'中等',uncertain:'不确定',direct:'直接',background:'背景',irrelevant:'不适用',initial:'首次',expanded:'扩展',provisional:'暂定',complete:'完成',interrupted:'中断'};
function DetailFields({value}:{value:unknown}) {
  if(Array.isArray(value))return <ul>{value.map((v,i)=><li key={i}><DetailFields value={v}/></li>)}</ul>;
  if(value && typeof value==='object')return <dl>{Object.entries(value).map(([k,v])=><div key={k}><dt>{labels[k] ?? k}</dt><dd><DetailFields value={v}/></dd></div>)}</dl>;
  const text=String(value ?? '未知');return <span>{typeof value==='boolean' ? value?'是':'否' : values[text] ?? text}</span>;
}
function InquiryPreview({inquiry,other}:{inquiry:Inquiry;other?:Inquiry}) {
  const changed = !other || inquiryContent(inquiry) !== inquiryContent(other);
  return <details className="recovery-inquiry" open={changed}>
    <summary>{inquiry.anchor.quote || inquiry.question} · {INTENT_META[inquiry.intent].shortLabel}
      <span>{!other ? '仅此份存在' : changed ? '内容或状态不同' : '相同知识贴'}</span>
    </summary>
    <p>学习状态：{STATUS_META[inquiry.status].label}</p>
    <blockquote>{inquiry.anchor.quote}</blockquote>
    {inquiry.question ? <p>{inquiry.question}</p> : null}
    {inquiry.messages.map(m=><section key={m.id} className="recovery-message">
      <strong>{m.role === 'assistant' ? '回答' : '提问'}{other && !other.messages.some(x=>x.id === m.id) ? ' · 仅此份存在' : ''}</strong>
      <Markdown text={m.content || '尚未收到正文'} />
      {m.completion === 'interrupted' ? <p>本次回答已中断，保留已收到内容。</p> : null}
      {m.search ? <p>搜索：{{executed:'已执行',failed:'失败','not-executed':'未执行',unknown:'未知'}[m.search.status]}</p> : null}
      {m.evidenceStatus ? <p>证据结论：{{supported:'支持',partial:'部分支持',unsupported:'不支持','not-applicable':'不适用'}[m.evidenceStatus]}</p> : null}
      {m.verification ? <details><summary>查证记录 · 第 {m.verification.round} 轮</summary><DetailFields value={m.verification} /></details> : null}
      {m.sources?.length ? <details><summary>相关来源（{m.sources.length}）</summary>{m.sources.map(s=><section key={s.id}><DetailFields value={s}/></section>)}</details> : null}
    </section>)}
    {inquiry.understanding ? <p>我的理解：{inquiry.understanding}</p> : null}
    {inquiry.lastError ? <p>{inquiry.lastError}</p> : null}
  </details>;
}
function Difference({row,expanded=false}:{row:RecoveryDifference;expanded?:boolean}) {
  const item=row.after ?? row.before!;
  return <details className={`recovery-difference ${row.kind}`} open={expanded}>
    <summary><span className="difference-title">{item.anchor.quote || item.question} · {INTENT_META[item.intent].shortLabel}</span><span className="difference-kind">{row.kind==='added'?'仅已保存记录有':row.kind==='removed'?'仅保留记录有':row.kind==='same'?'内容相同':row.fields.join(' · ')}</span></summary>
    <div className="recovery-columns">{row.before?<section><h4>保留记录</h4><InquiryPreview inquiry={row.before} other={row.after}/></section>:<p>保留记录中没有这一条。</p>}{row.after?<section><h4>已保存记录</h4><InquiryPreview inquiry={row.after} other={row.before}/></section>:<p>已保存记录中没有这一条。</p>}</div>
  </details>;
}
export function ReadingRecoveryView({library}:{library:Library}) {
  const dialog=useRef<HTMLDialogElement>(null), outsideDown=useRef(false);
  const record=library.recovery;
  useEffect(()=>{
    if (!record) return;
    const previous=document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return ()=>{dialog.current?.close();previous?.focus();};
  },[record?.id]);
  if (!record) return null;
  const pending=record.state==='pending';
  const saved=pending ? record.disk : record.current === undefined ? record.disk : record.current;
  const diff=saved ? recoveryDiff(record.draft.workspace,saved.workspace) : null;
  const separate=!record.disk || !sameOriginal(record.disk,record.draft);
  const outside=(event:React.PointerEvent<HTMLDialogElement>)=>{const r=event.currentTarget.getBoundingClientRect();return event.target===event.currentTarget&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);};
  return <dialog ref={dialog} className="recovery-dialog" aria-labelledby="recovery-title"
    onPointerDown={e=>{outsideDown.current=outside(e);}}
    onPointerUp={e=>{if(outsideDown.current&&outside(e)&&!library.busy)library.closeRecovery();outsideDown.current=false;}}
    onCancel={e=>{e.preventDefault();if(!library.busy)library.closeRecovery();}}>
    <header><div><h2 id="recovery-title">{!pending?'已使用所选阅读记录':saved?'请选择要继续使用的阅读记录':'找回保留的阅读记录'}</h2><p>{record.draft.workspace.document.filename}</p></div><button type="button" disabled={library.busy} onClick={library.closeRecovery} aria-label="关闭恢复记录">关闭</button></header>
    <div className="recovery-body">
      {library.error?<p role="alert" className="library-warning">{library.error}</p>:null}
      <p className="recovery-description">{saved?describeRecoveryDifference(record.draft.workspace,saved.workspace):'当前保存记录暂时无法读取。之前的阅读内容已保留，可另存为未关联原文件的条目。'}</p>
      {diff && (diff.counts.changed || diff.counts.removed)?<details className="recovery-needed-details" open={diff.counts.changed+diff.counts.removed===1}><summary>查看这 {diff.counts.changed+diff.counts.removed} 处差异</summary>{diff.rows.filter(r=>r.kind==='changed'||r.kind==='removed').map(row=><Difference key={row.id} row={row} expanded={diff.counts.changed+diff.counts.removed===1}/>)}</details>:null}
      {diff?.originalChanged?<details className="recovery-needed-details"><summary>查看不同的原文</summary><div className="recovery-columns">{[{workspace:record.draft.workspace,label:'之前保留的原文'},{workspace:saved!.workspace,label:'当前保存的原文'}].map(({workspace,label})=><section key={label}><h3>{label}</h3>{workspace.document.kind==='pdf'?<Suspense fallback={<p>正在加载原页…</p>}><PdfReader document={workspace.document} entryId={record.entryId} inquiries={workspace.inquiries} readOnly/></Suspense>:<Markdown text={workspace.document.markdown}/>}</section>)}</div></details>:null}
    </div>
    <footer className="recovery-footer"><p>{separate?'选择之前记录会另存一份，原文件保持不变。':'选择后继续阅读，另一份记录会安全保留。'}</p><div>
      {pending?<><button type="button" disabled={library.busy || (!!record.intent&&record.intent.choice!=='draft')} onClick={()=>void library.resolveRecovery('draft')}>使用之前记录（{record.draft.workspace.inquiries.length} 条）</button>{record.disk?<button className="recovery-primary" type="button" disabled={library.busy || (!!record.intent&&record.intent.choice!=='disk')} onClick={()=>void library.resolveRecovery('disk')}>使用当前记录（{record.disk.workspace.inquiries.length} 条）</button>:null}</>:<button className="recovery-primary" type="button" disabled={library.busy||!saved} onClick={()=>void library.acknowledgeRecovery()}>继续当前阅读</button>}
    </div></footer>
  </dialog>;
}
