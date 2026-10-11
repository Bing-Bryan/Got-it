import sharp from 'sharp';
import {validateGif} from './web-gif';
import { parseFragment, type DefaultTreeAdapterMap as Tree } from 'parse5';
import { WebError, WEB_LIMITS } from './web-fetch';
import type { WebMediaMime } from '../src/lib/web-data';
export interface ValidImage {bytes:Buffer;mime:WebMediaMime;width:number;height:number}
export async function validateStaticImage(bytes:Buffer):Promise<ValidImage>{
 if(!bytes.length||bytes.length>WEB_LIMITS.imageBytes)throw new WebError('图片超过容量限制。','web_image');
 if(["GIF87a","GIF89a"].includes(bytes.toString("ascii",0,6))){const info=validateGif(bytes);return {bytes,mime:"image/gif",width:info.width,height:info.height};}
 let mime:WebMediaMime;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){mime='image/png';let p=8;while(p+12<=bytes.length){const len=bytes.readUInt32BE(p),type=bytes.toString('ascii',p+4,p+8);if(type==='acTL')throw new WebError('暂不支持动画 PNG。','web_unsupported');if(len>bytes.length-p-12)throw new WebError('PNG 图片损坏。','web_image');p+=len+12;}}
 else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
 else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
  mime='image/webp';if(bytes.readUInt32LE(4)+8!==bytes.length)throw new WebError('WebP 图片损坏。','web_image');
  let p=12;while(p+8<=bytes.length){const type=bytes.toString('ascii',p,p+4),len=bytes.readUInt32LE(p+4);if(type==='ANIM'||type==='ANMF'||(type==='VP8X'&&((bytes[p+8]??0)&2)))throw new WebError('暂不支持动态 WebP。','web_unsupported');if(len>bytes.length-p-8)throw new WebError('WebP 图片损坏。','web_image');p+=8+len+(len%2);}
 }else throw new WebError('支持 PNG、JPEG、静态 WebP 与有界 GIF；其他动图和视频不导入。','web_unsupported');
 try{
  const image=sharp(bytes,{failOn:'warning',limitInputPixels:WEB_LIMITS.pixels,animated:false});const meta=await image.metadata();const width=meta.width??0,height=meta.height??0;
  if(!width||!height||width>WEB_LIMITS.dimension||height>WEB_LIMITS.dimension||width*height>WEB_LIMITS.pixels||(meta.pages??1)>1)throw new Error();
  await image.timeout({seconds:15}).raw().toBuffer();return{bytes,mime,width,height};
 }catch{throw new WebError('图片损坏或超过尺寸／像素限制。','web_image');}
}
const elements=new Set(['svg','g','path','rect','line','circle','ellipse','polyline','polygon','text','tspan','title','desc']);
const geometry=new Set(['x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','width','height','dx','dy','font-size','stroke-width','fill-opacity','stroke-opacity','opacity']);
const presentation=new Set(['fill','stroke','font-family','font-weight','font-style','text-anchor','dominant-baseline','stroke-linecap','stroke-linejoin','stroke-dasharray','paint-order','shape-rendering','font-variant-numeric']);
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function sanitizeStaticSvg(input:string,palette:Record<string,string>={}):ValidImage{
 if(Buffer.byteLength(input)>WEB_LIMITS.svgBytes||/<!|<\?|&(?:#|[A-Za-z])/i.test(input))throw new WebError('SVG 含不支持的实体或声明。','web_svg');
 const fragment=parseFragment(input);const roots=fragment.childNodes.filter(n=>n.nodeName!=='#text'||('value'in n&&n.value.trim()));
 if(roots.length!==1||!('tagName'in roots[0])||roots[0].tagName!=='svg')throw new WebError('SVG 格式无效。','web_svg');
 const root=roots[0] as Tree['element'];let count=0;
 function value(name:string,raw:string):string{
  const v=raw.replace(/var\((--[\w-]+)\)/g,(_s,key)=>{if(!palette[key])throw new WebError('SVG 图表颜色无法解析。','web_svg');return palette[key]});
  if(/[<>\\;{}]|url\s*\(|@|expression|javascript|var\(/i.test(v))throw new WebError('SVG 含不安全样式。','web_svg');
  if(geometry.has(name)&&!/^[-+\d.eE% ,]+$/.test(v))throw new WebError('SVG 尺寸无效。','web_svg');
  if(name==='font-family')return 'system-ui, sans-serif';
  if(!/^[\w\s#(),.%+\-]*$/.test(v))throw new WebError('SVG 属性无效。','web_svg');return v;
 }
 function walk(node:Tree['node'],depth:number):string{
  if(depth>WEB_LIMITS.svgDepth)throw new WebError('SVG 嵌套超过限制。','web_svg');
  if(node.nodeName==='#text')return escape((node as Tree['textNode']).value);
  if(!('tagName'in node))throw new WebError('SVG 含不支持的节点。','web_svg');
  if(++count>WEB_LIMITS.svgElements)throw new WebError('SVG 元素超过限制。','web_svg');
  if(node.tagName==='style'){
   const css=node.childNodes.map(n=>'value'in n?n.value:'').join('');
   // Recognise only source's inert font fallback rules, reconstructed on text elements below.
   if(/url|@|\\|animation|expression|javascript|[<>]/i.test(css)||!/^(?:\s*#[\w-]+\s+(?:text|\.tnum)\s*\{(?:font-family:[\w\s,'-]+|font-variant-numeric:tabular-nums)\}\s*)+$/.test(css))throw new WebError('SVG 样式不在静态白名单内。','web_svg');
   return '';
  }
  if(!elements.has(node.tagName)||node.namespaceURI!=='http://www.w3.org/2000/svg')throw new WebError('SVG 含脚本、动画或其他不支持内容。','web_svg');
  const attrs:string[]=[];
  for(const a of node.attrs){
   const name=a.name;
   if(name==='xmlns'){if(a.value!=='http://www.w3.org/2000/svg')throw new WebError('SVG 命名空间无效。','web_svg');continue;}
   if(a.prefix||a.namespace)throw new WebError('SVG 外部引用不可用。','web_svg');
   if(['class','id','aria-hidden','focusable','role','aria-label'].includes(name))continue;
   if(name==='style'){
    for(const decl of a.value.split(';').filter(s=>s.trim())){const colon=decl.indexOf(':');const prop=decl.slice(0,colon).trim(),v=decl.slice(colon+1).trim();if(colon<0||(!presentation.has(prop)&&!geometry.has(prop)))throw new WebError('SVG 样式不在白名单内。','web_svg');attrs.push(`${prop}="${escape(value(prop,v))}"`);}continue;
   }
   if(name==='viewBox'){if(!/^[-+\d.eE ,]+$/.test(a.value))throw new WebError('SVG viewBox 无效。');attrs.push(`viewBox="${escape(a.value)}"`);continue;}
   if(name==='d'||name==='points'||name==='transform'){if(!/^[a-zA-Z\d\s.,()+-]+$/.test(a.value))throw new WebError('SVG 几何数据无效。');attrs.push(`${name}="${escape(a.value)}"`);continue;}
   if(!geometry.has(name)&&!presentation.has(name))throw new WebError('SVG 属性不在白名单内。','web_svg');attrs.push(`${name}="${escape(value(name,a.value))}"`);
  }
  if(node.tagName==='svg')attrs.push('xmlns="http://www.w3.org/2000/svg"');
  if(node.tagName==='text')attrs.push('font-family="system-ui, sans-serif"','font-variant-numeric="tabular-nums"');
  return `<${node.tagName}${attrs.length?' '+attrs.join(' '):''}>${node.childNodes.map(n=>walk(n,depth+1)).join('')}</${node.tagName}>`;
 }
 const svg=walk(root,0),viewBox=root.attrs.find(a=>a.name==='viewBox')?.value.split(/[ ,]+/).map(Number),width=Number(root.attrs.find(a=>a.name==='width')?.value)||viewBox?.[2]||0,height=Number(root.attrs.find(a=>a.name==='height')?.value)||viewBox?.[3]||0;
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>WEB_LIMITS.dimension||height>WEB_LIMITS.dimension||width*height>WEB_LIMITS.pixels)throw new WebError('SVG 尺寸超过限制。','web_svg');
 return{bytes:Buffer.from(svg),mime:'image/svg+xml',width,height};
}
