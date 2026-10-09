import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {copyOutline,type PdfOutline} from '../src/lib/pdf-outline';
import {resourceId} from '../src/lib/pdf-data';
import {LibraryError} from './file-picker';
import type {ReadingLibrary} from './reading-library';
export class PdfOutlineStore {
  private pending:Promise<unknown>=Promise.resolve();
  constructor(private library:ReadingLibrary){}
  private async location(id:string,hash:string){
    if(!resourceId(hash))throw new LibraryError('PDF 版本无效。',400);
    const entry=await this.library.get(id);
    if(entry.workspace.document.kind!=='pdf'||entry.workspace.document.pdf.resourceId!==hash)throw new LibraryError('PDF 已切换版本，请重新打开目录。',409);
    return {path:join(this.library.dir,'entries',id,'outlines',`${hash}.json`),pages:entry.workspace.document.pdf.pages.length};
  }
  async get(id:string,hash:string):Promise<PdfOutline>{
    const {path,pages}=await this.location(id,hash);
    try{return copyOutline(JSON.parse(await readFile(path,'utf8')),hash,pages);}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {version:1,fileHash:hash,revision:0,reviewed:false,items:[]};throw new LibraryError('目录无法读取，已有阅读内容不受影响。',503);}
  }
  async save(id:string,hash:string,value:unknown){
    const work=this.pending.then(async()=>{
      const {path,pages}=await this.location(id,hash);
      let outline:PdfOutline;try{outline=copyOutline(value,hash,pages);}catch(e){throw new LibraryError((e as Error).message,400);}
      const current=await this.get(id,hash);if(current.revision!==outline.revision)throw new LibraryError('另一页面已更新目录，请重新载入后核对；本次修改尚未保存。',409);
      outline.revision++;await mkdir(join(path,'..'),{recursive:true,mode:0o700});const tmp=`${path}.${randomUUID()}.tmp`;
      try{const f=await open(tmp,'wx',0o600);try{await f.writeFile(JSON.stringify(outline));await f.sync();}finally{await f.close();}await rename(tmp,path);}finally{await rm(tmp,{force:true}).catch(()=>{});}
      return outline;
    });this.pending=work.catch(()=>{});return work;
  }
}
