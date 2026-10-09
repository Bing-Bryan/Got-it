import type { Anchor, DocumentSnapshot } from '../types';
export const DOCUMENT_CONTEXT_LIMIT = 16_000;
export interface DocumentSection { label: string; text: string }
export function documentAnchor(document: DocumentSnapshot): Anchor {
  return { scope:'document',textVersion:2,documentId:document.id,blockId:'document',headingPath:[],quote:'全文',prefix:'',suffix:'',start:0,end:0,matchStatus:'matched' };
}
export function markdownSections(article: HTMLElement | null): DocumentSection[] {
  if (!article) return [];
  let label = '开头';
  return [...article.children].flatMap(node => {
    if (/^H[1-6]$/.test(node.tagName)) label = node.textContent?.trim() || label;
    const text = (node.textContent ?? '').trim();
    return text ? [{label,text}] : [];
  });
}
export function documentQuestionContext(sections: DocumentSection[], question: string, notice = '') {
  const usable = sections.filter(s => s.text.trim());
  if (!usable.length) throw new Error('本文没有可供提问的文字，请选择具体内容或换一份文档。');
  const full = usable.map(s => `【${s.label}】\n${s.text}`).join('\n\n');
  const fullPrefix = `参考范围：完整可用文字。${notice}\n`;
  if (fullPrefix.length + full.length <= DOCUMENT_CONTEXT_LIMIT) return { context: fullPrefix + full, notice };
  const tokens = (question.toLowerCase().match(/[a-z0-9][a-z0-9.-]+|[\u3400-\u9fff]+/g) ?? []).flatMap(t => /[\u3400-\u9fff]/.test(t) ? Array.from({length:Math.max(0,t.length-1)},(_,i)=>t.slice(i,i+2)) : [t]);
  const terms = [...new Set(tokens)].filter(t => !['什么','怎么','哪些','这个','那个','文章','全文','是否','可以'].includes(t)).slice(0,64);
  const chunks = usable.flatMap(section => Array.from({length:Math.ceil(section.text.length/1200)},(_,i)=>({label:section.label,text:section.text.slice(i*1200,(i+1)*1200)})));
  const outline = [...new Set(usable.map(s=>s.label))].join(' / ').slice(0,1200);
  const prefix = `参考范围：长文相关片段，并非全文覆盖。${notice}\n文章结构：${outline}\n`;
  const ranked = chunks.map((s,index)=>({index,score:terms.reduce((sum,t)=>sum+(s.text.toLowerCase().includes(t)?1:0)+(s.label.toLowerCase().includes(t)?2:0),0)})).sort((a,b)=>b.score-a.score||a.index-b.index);
  const selected = new Set<number>(); let remaining = DOCUMENT_CONTEXT_LIMIT - prefix.length;
  for (const index of [...[0,1].filter(i=>i<chunks.length),...ranked.map(r=>r.index)]) {
    if (selected.has(index)) continue;
    const s=chunks[index], size=s.text.length+s.label.length+6;
    if(size>remaining)continue;
    selected.add(index); remaining-=size;
  }
  const context = prefix + [...selected].sort((a,b)=>a-b).map(i=>`【${chunks[i].label}】\n${chunks[i].text}`).join('\n\n');
  return {context:context.slice(0,DOCUMENT_CONTEXT_LIMIT),notice:['基于文章结构与相关片段作答。',notice].filter(Boolean).join(' ')};
}
