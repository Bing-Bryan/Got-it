import { webUrl, WebError } from './web-fetch';
/** Generic syntax policy. Every request must additionally check all DNS answers and pin its IP. */
export function articleUrl(input: unknown): URL {
 const url=webUrl(input);
 if(url.protocol!=='https:')throw new WebError('请使用公开 HTTPS 静态文章链接。','web_url_invalid');
 return url;
}
export const mediaUrl=articleUrl;
/** Preserve the known Next image source, validating it exactly like any other external resource. */
export function sourceImageUrl(raw:string,base:URL):URL{
 const url=articleUrl(new URL(raw,base).href);
 if(url.hostname==='www.anthropic.com'&&url.pathname==='/_next/image'){
  const targets=url.searchParams.getAll('url');
  if(targets.length!==1)throw new WebError('文章图片代理地址无效。','web_resource_host');
  return mediaUrl(new URL(targets[0],base).href);
 }
 return mediaUrl(url.href);
}
