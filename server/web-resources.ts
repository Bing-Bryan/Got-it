import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from '../src/types';
import type { WebMedia } from '../src/lib/web-data';
import { WebError } from './web-fetch';
import type { ValidImage } from './web-media';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export class WebResources {
 constructor(private root:string){}
 private path(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw new WebError('静态资源标识无效。','web_resource',404);return join(this.root,'objects',id+'.bin');}
 private async syncDir(path:string){if(process.platform==='win32')return;const f=await open(path,'r');try{await f.sync()}finally{await f.close()}}
 async put(resources:Map<string,ValidImage>,inserted=new Set<string>()){
  await mkdir(join(this.root,'objects'),{recursive:true,mode:0o700});
  for(const [id,image] of resources){
   if(sha(image.bytes)!==id)throw new WebError('静态资源校验失败，未保存。','web_resource');
   const path=this.path(id),temp=path+'.'+randomUUID()+'.tmp';
   try{await access(path)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')inserted.add(id);else throw e;}
   try{const f=await open(temp,'wx',0o600);try{await f.writeFile(image.bytes);await f.sync()}finally{await f.close()}await rename(temp,path)}finally{await rm(temp,{force:true}).catch(()=>{})}
  }
  await this.syncDir(join(this.root,'objects'));
 }
 async removeUnreferenced(inserted:Set<string>,referenced:Set<string>){for(const id of inserted)if(!referenced.has(id))await rm(this.path(id),{force:true});await this.syncDir(join(this.root,'objects'));}
 async read(media:WebMedia){
  if(media.status!=='saved'||!media.resourceId||!media.mime)throw new WebError('图片未成功导入。','web_resource_missing',404);
  let bytes:Buffer;try{bytes=await readFile(this.path(media.resourceId))}catch{throw new WebError('本机图片缺失，请保留正文并重新尝试导入。','web_resource_missing',404)}
  if(sha(bytes)!==media.resourceId||bytes.length!==media.bytes)throw new WebError('本机图片损坏，无法显示。','web_resource_corrupt',409);
  return{bytes,mime:media.mime};
 }
 async validate(w:Workspace){if(w.document.kind!=='web')return;for(const media of w.document.web.media)if(media.status==='saved')await this.read(media);}
}
