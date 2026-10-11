import {WebError} from './web-fetch';
export const GIF_LIMITS={bytes:32*1024*1024,dimension:4096,canvasPixels:4_000_000,frames:512,framePixels:120_000_000,durationMs:30_000,validationMs:15_000} as const;
export interface GifInfo {width:number;height:number;frames:number;durationMs:number;zeroDelays:number;framePixels:number;loop?:number}
interface Raster {data:Buffer;minCodeSize:number;pixels:number;colors:number}
function invalid(message:string):never{throw new WebError(message,'web_gif');}
/** Fully checks bounded GIF blocks and LZW output lengths without allocating decoded RGBA frames. */
export function validateGif(bytes:Buffer):GifInfo{
 const started=performance.now();let p=0;const need=(n:number)=>{if(p+n>bytes.length)invalid('GIF 数据截断或损坏。');};const byte=()=>{need(1);return bytes[p++];};const skip=(n:number)=>{need(n);p+=n;};const u16=()=>{need(2);const n=bytes.readUInt16LE(p);p+=2;return n;};
 if(bytes.length>GIF_LIMITS.bytes)invalid('GIF 文件超过32 MiB限制。');need(13);if(!['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)))invalid('GIF 文件签名无效。');p=6;
 const width=u16(),height=u16(),packed=byte(),background=byte();byte();
 if(!width||!height||width>GIF_LIMITS.dimension||height>GIF_LIMITS.dimension||width*height>GIF_LIMITS.canvasPixels)invalid('GIF 画布超过尺寸或400万像素限制。');
 const globalColors=packed&128?1<<((packed&7)+1):0;if(globalColors){if(background>=globalColors)invalid('GIF 背景色索引无效。');skip(globalColors*3);}
 const rasters:Raster[]=[];let durationMs=0,zeroDelays=0,framePixels=0,delay=0,transparent:number|undefined,loop:number|undefined;
 const blocks=(retain=true)=>{const start=p;let length=0,count=0;for(;;){if(++count%4096===0&&performance.now()-started>GIF_LIMITS.validationMs)invalid('GIF 块校验超过时间限制。');const n=byte();if(!n)break;need(n);length+=n;p+=n;}if(!retain)return Buffer.alloc(0);const result=Buffer.allocUnsafe(length);let offset=start,out=0;for(;;){const n=bytes[offset++];if(!n)break;bytes.copy(result,out,offset,offset+n);out+=n;offset+=n;}return result;};
 for(;;){
  if(performance.now()-started>GIF_LIMITS.validationMs)invalid('GIF 校验超过时间限制。');
  const marker=byte();if(marker===0x3b){if(p!==bytes.length||!rasters.length)invalid('GIF 终止符或尾部数据无效。');break;}
  if(marker===0x21){const label=byte();if(label===0xf9){if(byte()!==4)invalid('GIF 控制块长度无效。');const flags=byte();if(flags&0xe0||(flags>>2&7)>3)invalid('GIF 帧控制无效。');delay=u16()*10;const index=byte();transparent=flags&1?index:undefined;if(byte()!==0)invalid('GIF 控制块未结束。');}
   else if(label===0xff){if(byte()!==11)invalid('GIF 扩展长度无效。');need(11);const app=bytes.toString('ascii',p,p+11);p+=11;const data=blocks();if(app==='NETSCAPE2.0'||app==='ANIMEXTS1.0'){if(data.length!==3||data[0]!==1)invalid('GIF 循环扩展无效。');loop=data.readUInt16LE(1);}}
   else if(label===0xfe)blocks(false);else invalid('GIF 含不支持的扩展块。');continue;
  }
  if(marker!==0x2c)invalid('GIF 块标识无效。');const left=u16(),top=u16(),w=u16(),h=u16(),flags=byte();if(!w||!h||left+w>width||top+h>height||flags&0x18)invalid('GIF 帧越出画布或尺寸无效。');
  if(rasters.length>=GIF_LIMITS.frames)invalid('GIF 超过512帧限制。');framePixels+=w*h;if(framePixels>GIF_LIMITS.framePixels)invalid('GIF 累积帧像素超过1.2亿限制。');durationMs+=delay;if(durationMs>GIF_LIMITS.durationMs)invalid('GIF 单循环时长超过30秒限制。');if(!delay)zeroDelays++;delay=0;
  const colors=flags&128?1<<((flags&7)+1):globalColors;if(!colors)invalid('GIF 缺少调色板。');if(flags&128)skip(colors*3);if(transparent!==undefined&&transparent>=colors)invalid('GIF 透明色索引无效。');transparent=undefined;
  const minCodeSize=byte();if(minCodeSize<2||minCodeSize>8)invalid('GIF LZW位数无效。');const data=blocks();if(!data.length)invalid('GIF 缺少帧数据。');rasters.push({data,minCodeSize,pixels:w*h,colors});
 }
 for(const raster of rasters)validateRaster(raster,started);
 return{width,height,frames:rasters.length,durationMs,zeroDelays,framePixels,...(loop===undefined?{}:{loop})};
}
function validateRaster({data,minCodeSize,pixels,colors}:Raster,started:number){
 const lengths=new Uint32Array(4096);const clear=1<<minCodeSize,end=clear+1;for(let i=0;i<clear;i++)lengths[i]=1;
 let size=minCodeSize+1,next=end+1,previous=-1,offset=0,output=0,codes=0,first=true;
 for(;;){
  if(++codes%4096===0&&performance.now()-started>GIF_LIMITS.validationMs)invalid('GIF LZW校验超过时间限制。');
  if(offset+size>data.length*8)invalid('GIF LZW数据截断。');let code=0;for(let bit=0;bit<size;bit++,offset++)code|=((data[offset>>3]>>(offset&7))&1)<<bit;
  if(first&&code!==clear)invalid('GIF LZW缺少初始清除码。');first=false;
  if(code===clear){size=minCodeSize+1;next=end+1;previous=-1;continue;}
  if(code===end){if(output!==pixels||Math.ceil(offset/8)!==data.length)invalid('GIF LZW像素数量或结束数据无效。');return;}
  if(code<clear&&code>=colors)invalid('GIF 像素调色板索引无效。');
  const length=code<next&&(code<clear||code>end)?lengths[code]:code===next&&previous>=0?lengths[previous]+1:0;
  if(!length||previous<0&&code>=clear)invalid('GIF LZW字典引用无效。');output+=length;if(output>pixels)invalid('GIF LZW解码像素超过帧尺寸。');
  if(previous>=0&&next<4096){lengths[next++]=lengths[previous]+1;if(next===(1<<size)&&size<12)size++;}previous=code;
 }
}
