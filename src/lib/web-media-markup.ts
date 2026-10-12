import {safeXImageSourceUrl,type WebMedia} from './web-data';
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
/** Preserve legacy markup/block IDs; new public X sources carry explicit missing status and an inert link. */
export function missingWebMediaHtml(media:WebMedia):string {
 const url=safeXImageSourceUrl(media.sourceUrl);
 if(!url)return `<span class="image-unavailable">${esc(media.alt||'图片')}：${esc(media.reason||'未导入')}</span>`;
 return `<span class="image-unavailable">${esc(media.alt||'图片')}：图片未保存到本机。${esc(media.reason||'')} <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看原图</a></span>`;
}
