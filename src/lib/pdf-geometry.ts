import type {PdfRect} from './pdf-data';
interface Viewport {width:number;height:number;convertToViewportPoint(x:number,y:number):number[];convertToPdfPoint(x:number,y:number):number[]}
export const normalized=(r:number[]):PdfRect=>[Math.min(r[0],r[2]),Math.min(r[1],r[3]),Math.max(r[0],r[2]),Math.max(r[1],r[3])];
export const screenRect=(v:Viewport,r:PdfRect)=>normalized([...v.convertToViewportPoint(r[0],r[1]),...v.convertToViewportPoint(r[2],r[3])]);
export function originalRect(v:Viewport,r:PdfRect):PdfRect{
 const bounded=r.map((n,i)=>Math.max(0,Math.min(i%2?v.height:v.width,n)));
 return normalized([...v.convertToPdfPoint(bounded[0],bounded[1]),...v.convertToPdfPoint(bounded[2],bounded[3])]);
}
