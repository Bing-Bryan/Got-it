import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompactSources } from './CompactSources';
import { AssistantMessage } from './App';
import type { ThreadMessage } from './types';
const message: ThreadMessage = { id:'m',role:'assistant',content:'',createdAt:'2026',explanationMode:'auto',sources:[
 {id:'one',title:'产品官网',url:'https://example.org/',domain:'example.org',retrievalStatus:'unavailable'},
 {id:'two',title:'产品资料',url:'https://example.org/docs',domain:'example.org',retrievalStatus:'matched'}
],search:{status:'executed',completedSearches:1,failedSearches:0} };
it('deduplicates body links while retaining unread reference limits without cards',()=>{
 const html=renderToStaticMarkup(<CompactSources message={message} answerHtml='<p><a href="https://example.org/#intro">官网</a></p>'/>);
 expect(html).not.toContain('产品官网');expect(html).toContain('产品资料');expect(html).toContain('正文未取得');
 expect(html).not.toContain('source-evidence-card');expect(html).not.toContain('已核实');
});
it.each(['failed','not-executed'] as const)('retains search %s even if all references are already in the answer',status=>{
 const html=renderToStaticMarkup(<CompactSources message={{...message,sources:[message.sources![0]],search:{status,completedSearches:0,failedSearches:0}}} answerHtml='<a href="https://example.org">官网</a>'/>);
 expect(html).not.toContain('<a ');expect(html).toContain(status==='failed'?'资料查找失败':'本轮未搜索');expect(html).toContain('正文未取得');
});
it('never creates unsafe links and does not change stored source data',()=>{
 const unsafe={...message,sources:[{id:'bad',title:'危险链接',url:'javascript:alert(1)',domain:''}]};const before=JSON.stringify(unsafe);
 const html=renderToStaticMarkup(<CompactSources message={unsafe} answerHtml=''/>);
 expect(html).not.toContain('href=');expect(html).toContain('链接不可用');expect(JSON.stringify(unsafe)).toBe(before);
});
it('retains complete source cards for verification',()=>{
 const html=renderToStaticMarkup(<AssistantMessage verification message={{...message,operation:'verify',verification:{verdict:'insufficient',summary:'资料不足',reason:'受控',readingAdvice:'保留限制',claims:[],completion:'complete',round:1,scope:'initial'}}}/>);
 expect(html).toContain('source-evidence-card');expect(html).not.toContain('查看详情');expect(html).toContain('未取得片段');
});

it.each(['unknown', undefined] as const)('omits generic warning for %s search without altering data', status => {
 const item = {...message, search: status ? {...message.search!, status} : undefined};
 const before = JSON.stringify(item);
 const html = renderToStaticMarkup(<CompactSources message={item} answerHtml=''/>);
 expect(html).not.toContain('尚未确认搜索成功');
 expect(html).not.toContain('已核实');
 expect(html).toContain('正文未取得');
 expect(JSON.stringify(item)).toBe(before);
});
