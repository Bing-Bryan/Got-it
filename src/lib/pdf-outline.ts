import {resourceId} from './pdf-data';
export interface PdfOutlineItem {id:string;title:string;page:number;top:number;level:1|2|3;source:'bookmark'|'native'|'ocr'|'manual'}
export interface PdfOutline {version:1;fileHash:string;revision:number;reviewed:boolean;items:PdfOutlineItem[]}
export interface OutlineLine {text:string;x:number;y:number;width:number;height:number}
export const cleanTitle=(s:string)=>s.replace(/\s+/g,' ').trim().replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'');
export function copyOutline(value:unknown,fileHash:string,pages:number):PdfOutline {
  const v=value as PdfOutline|null;
  if(!v||v.version!==1||!resourceId(fileHash)||v.fileHash!==fileHash||!Number.isSafeInteger(v.revision)||v.revision<0||typeof v.reviewed!=='boolean'||!Array.isArray(v.items)||v.items.length>600)throw new Error('目录格式或文档版本无效。');
  const ids=new Set<string>();
  const items=v.items.map(i=>{
    if(!i||typeof i.id!=='string'||!/^[\w-]{1,80}$/.test(i.id)||ids.has(i.id)||typeof i.title!=='string'||!i.title.trim()||i.title.length>160||!Number.isInteger(i.page)||i.page<1||i.page>pages||!Number.isFinite(i.top)||i.top<0||i.top>1||![1,2,3].includes(i.level)||!['bookmark','native','ocr','manual'].includes(i.source))throw new Error('目录标题、层级或页码无效。');
    ids.add(i.id);return {id:i.id,title:i.title.trim(),page:i.page,top:i.top,level:i.level,source:i.source};
  });
  return {version:1,fileHash,revision:v.revision,reviewed:v.reviewed,items:items.sort((a,b)=>a.page-b.page||a.top-b.top)};
}
// Geometry is normalized to the rendered page, so rotation and resizing preserve destinations.
export function mergeOutlineLines(input:OutlineLine[]):OutlineLine[]{
  const result:OutlineLine[]=[];
  for(const line of [...input].filter(l=>cleanTitle(l.text)&&l.height>0).sort((a,b)=>a.y-b.y||a.x-b.x)){
    const row=result.find(r=>Math.abs((r.y+r.height/2)-(line.y+line.height/2))<Math.min(r.height,line.height)*.5&&Math.abs(r.height-line.height)<Math.max(r.height,line.height)*.4&&Math.max(line.x-r.x-r.width,r.x-line.x-line.width)<Math.max(.025,line.height*2));
    if(row){row.text=cleanTitle(line.x<row.x?line.text+' '+row.text:row.text+' '+line.text);const right=Math.max(row.x+row.width,line.x+line.width);row.x=Math.min(row.x,line.x);row.width=right-row.x;row.y=Math.min(row.y,line.y);row.height=Math.max(row.height,line.height);}
    else result.push({...line,text:cleanTitle(line.text)});
  }
  return result.sort((a,b)=>a.y-b.y||a.x-b.x);
}
export function pageHeading(input:OutlineLine[],page:number,source:'native'|'ocr'):PdfOutlineItem|null{
  const lines=mergeOutlineLines(input).filter(l=>l.y>=0&&l.y<.8&&l.x<.85&&l.text.length<=160&&/[\p{L}]/u.test(l.text)&&!/^https?:|www\.|@/i.test(l.text));
  if(!lines.length)return null;
  const heights=lines.map(l=>l.height).sort((a,b)=>a-b),median=heights[Math.floor((heights.length-1)/2)];
  // Prefer a clear page heading over large lettering inside photographs/charts.
  const early=lines.find(l=>l.y<.12&&l.height>=.016&&(l.height>=median*1.2||(l.y<.065&&l.x<.5&&l.text.length<=80))&&l.text.length<100);
  const largest=Math.max(...lines.map(l=>l.height));
  let selected:OutlineLine[]=[];
  if(early){selected=[early];}
  else if(largest>=.038){selected=lines.filter(l=>l.height>=largest*.78&&l.y<.65&&l.text.length<=60);}
  else {const first=lines[0];if(first.y<.18&&first.height>=.016&&first.height>=median*1.2)selected=[first];}
  if(!selected.length)return null;
  const first=selected[0];const connected=[first];
  for(const l of selected.slice(1)){const last=connected[connected.length-1];if(l.y-last.y-last.height>Math.max(.065,last.height)||Math.abs(l.x-first.x)>.12)break;connected.push(l);}
  const title=connected.map(l=>cleanTitle(l.text)).join(' ');if(title.length>160)return null;
  return {id:`heading-${page}`,title,page,top:Math.max(0,first.y-.015),level:first.height>=.038?1:2,source};
}
