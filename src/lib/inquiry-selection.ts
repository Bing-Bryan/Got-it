import type {Anchor,ActiveInquiryIntent} from '../types';
import {selectedQuote,translationContext} from './translation-reading';
import {readingContext,questionContext} from './reading-context';
export const INQUIRY_SELECTION_LIMITS={quote:20000,multiContext:6000,context:50000,question:10000,ask:2000} as const;
export function selectionContext(article:HTMLElement|null,anchor:Anchor,intent:ActiveInquiryIntent,question:string){
 if(anchor.segments){const first=anchor.segments[0].translation??anchor.segments[0],last=anchor.segments.at(-1)!.translation??anchor.segments.at(-1)!;
  const mapped=translationContext(anchor);return [mapped,`选区前文：${first.prefix}`,`选区后文：${last.suffix}`].filter(Boolean).join('\n');
 }
 return translationContext(anchor)??(intent==='ask'?questionContext(article,anchor,question):readingContext(article,anchor));
}
export function selectionRequestError(anchor:Anchor,question:string,context:string,intent:ActiveInquiryIntent):string|undefined{
 if(selectedQuote(anchor).length>INQUIRY_SELECTION_LIMITS.quote)return '选区超过 20000 字符，无法完整发送。请缩小选区后重试；收藏仍可保留完整内容。';
 if(question.length>(intent==='ask'?INQUIRY_SELECTION_LIMITS.ask:INQUIRY_SELECTION_LIMITS.question))return '问题超过本次请求容量，请缩短后重试。';
 if(context.length>(anchor.segments?INQUIRY_SELECTION_LIMITS.multiContext:INQUIRY_SELECTION_LIMITS.context))return '必要上下文超过本次请求容量，无法完整发送。请缩小选区后重试。';
}
