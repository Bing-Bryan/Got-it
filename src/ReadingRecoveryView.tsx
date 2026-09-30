import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import type { useReadingLibrary } from './useReadingLibrary';
import { inquiryContent, sameOriginal } from './lib/reading-recovery';
import { renderMarkdown } from './lib/markdown';
import { STATUS_META, INTENT_META, type Inquiry, type Workspace } from './types';

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
function Snapshot({workspace,other,entryId}:{workspace:Workspace;other?:Workspace;entryId:string}) {
  const others = new Map(other?.inquiries.map(i=>[i.id,i]));
  return <>
    <details className="recovery-original"><summary>查看原文 · {workspace.document.filename}</summary>{workspace.document.kind === "pdf" ? <Suspense fallback={<p>正在加载原页…</p>}><PdfReader document={workspace.document} entryId={entryId} inquiries={workspace.inquiries} readOnly/></Suspense> : <Markdown text={workspace.document.markdown} />}</details>
    <p>{workspace.inquiries.length} 张知识贴</p>
    {workspace.inquiries.map(i=><InquiryPreview key={i.id} inquiry={i} other={others.get(i.id)} />)}
    {!workspace.inquiries.length ? <p>这份记录没有知识贴。</p> : null}
  </>;
}
export function ReadingRecoveryView({library}:{library:Library}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const record=library.recovery;
  useEffect(()=>{
    if (!record) return;
    const previous=document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return ()=>{dialog.current?.close();previous?.focus();};
  },[record?.id]);
  if (!record) return null;
  const separate=!record.disk || !sameOriginal(record.disk,record.draft);
  const pending=record.state === 'pending';
  return <dialog ref={dialog} className="recovery-dialog" aria-labelledby="recovery-title" onCancel={e=>{if(library.busy)e.preventDefault();else library.closeRecovery();}}>
    <header><div><h2 id="recovery-title">{pending ? '两份阅读记录需要核对' : '保留的阅读记录 · 只读'}</h2><p>{pending ? (record.reason === 'unreadable' ? '原来的记录暂时无法读取。可读的阅读内容已单独保留。' : record.reason === 'unknown' ? '无法确认哪份包含全部修改，请查看具体内容再选择。' : '阅读内容存在差异，请查看后选择继续哪份。') : '选择后保留的快照，不会改变当前阅读内容。'}</p></div><button type="button" disabled={library.busy} onClick={library.closeRecovery} aria-label="关闭恢复记录">关闭</button></header>
    {library.error ? <p role="alert">{library.error}</p> : null}
    {pending ? <p className="recovery-assurance">可读记录已保存到本机。可以稍后处理；选择后另一份仍可回看。</p> : null}
    <div className="recovery-columns">
      <section><h3>上次未保存的阅读记录</h3><p>记录时间：未知（不以时间判断新旧）</p>
        {pending ? <><p>{separate ? '继续后将另存为未关联原文件的阅读条目，原条目保持。' : '继续后用于当前材料；另一份保留可回看。'}</p><button type="button" disabled={library.busy || (!!record.intent && record.intent.choice !== 'draft')} onClick={()=>void library.resolveRecovery('draft')}>继续这份阅读记录</button></> : null}
        <Snapshot entryId={record.entryId} workspace={record.draft.workspace} other={record.disk?.workspace} />
      </section>
      <section><h3>已保存的阅读记录</h3>
        {record.disk ? <>{pending ? <><p>继续后保留上次未保存的那份，可随时回看。</p><button type="button" disabled={library.busy || (!!record.intent && record.intent.choice !== 'disk')} onClick={()=>void library.resolveRecovery('disk')}>继续已保存的记录</button></> : null}<Snapshot entryId={record.entryId} workspace={record.disk.workspace} other={record.draft.workspace} /></> : <p>这份记录暂时无法读取，未用空白内容代替。</p>}
      </section>
    </div>
    {record.previous.length ? <details><summary>核对期间保留的其他记录（{record.previous.length}）</summary>{record.previous.map((s,i)=><section key={i}><h3>核对时的记录 {i+1} · 只读</h3><Snapshot entryId={record.entryId} workspace={s.workspace} /></section>)}</details> : null}
  </dialog>;
}
