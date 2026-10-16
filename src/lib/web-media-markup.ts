import {safeImageSourceUrl,type WebMedia} from './web-data';
export const escapeMediaText=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function mediaLegacyText(media:WebMedia):string|undefined {
 const state=media.legacyMissing??(media.status!=='saved'?{reason:media.reason??'未导入',linked:!!safeImageSourceUrl(media.sourceUrl)}:undefined);if(!state)return;
 return state.linked?`${media.alt||'图片'}：图片未保存到本机。${state.reason} 查看原图`:`${media.alt||'图片'}：${state.reason||'未导入'}`;
}
export function mediaLegacyAttribute(media:WebMedia){const text=mediaLegacyText(media);return text===undefined?'':` data-web-legacy-text="${escapeMediaText(text)}"`;}
/** Status is visible and accessible, but never becomes source text or selection offsets. */
export function missingWebMediaHtml(media:WebMedia):string {
 const esc=escapeMediaText,url=safeImageSourceUrl(media.sourceUrl),label=url?`${media.alt||'图片'}：图片未保存到本机。${media.reason||''}`:`${media.alt||'图片'}：${media.reason||'未导入'}`;
 return `<span class="image-unavailable"${mediaLegacyAttribute(media)} data-media-label="${esc(label)}" role="img" aria-label="${esc(label)}">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="查看原图" data-media-label="查看原图"></a>`:''}<span data-web-media-retry="${esc(media.id)}"></span></span>`;
}

/** Source HTML cannot claim generated compatibility metadata. */
export function stripWebCompatAttributes(html:string){return html.replace(/\sdata-web-(?:legacy-text|anchor-legacy|media-retry)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'');}
