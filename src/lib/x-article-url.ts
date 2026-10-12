import {safeWebUrl} from './web-data';
export const X_PUBLIC_EXTRACTOR='x-fxtwitter-public-v1';
export const X_PUBLIC_SCOPE='经 FxTwitter 公开接口获取，未独立核验原站全文';
export interface XPublicAddress {url:string;id:string;kind:'article'|'status';handle?:string}
/** Validate credential safety before discarding sharing parameters. Keep the supplied permalink. */
export function xPublicAddress(input:unknown):XPublicAddress|undefined {
 const safe=safeWebUrl(input);if(!safe)return;const u=new URL(safe);
 for(const key of [...u.searchParams.keys(),...(u.hash.includes('=')?new URLSearchParams(u.hash.slice(1)).keys():[])])if(/^(?:access[_-]?token|auth|authorization|api[_-]?key|token|secret|password|passwd|signature|sig|credential|key|x-amz-.+|x-goog-.+)$/i.test(key))return;
 if(u.protocol!=='https:'||u.port||!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname))return;
 const m=/^\/(i|[A-Za-z0-9_]{1,15})\/(article|status)\/(\d{1,30})\/?$/.exec(u.pathname);if(!m)return;
 return{url:`https://x.com${u.pathname.replace(/\/$/,'')}`,id:m[3],kind:m[2]as'article'|'status',...(m[1]==='i'?{}:{handle:m[1]})};
}
export function normalizeXArticleUrl(input:unknown):string|undefined{return xPublicAddress(input)?.url;}
export function xArticleIdentity(input:unknown):string|undefined{const address=xPublicAddress(input);return address?`x-${address.kind}:${address.id}`:undefined;}
