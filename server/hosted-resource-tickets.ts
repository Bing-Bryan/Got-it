import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {constants,closeSync,fchmodSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {HostedError} from './hosted-budget';
import {absolutePath,privateMode,syncDirectory} from './private-storage';
import {safeWebUrl,WEB_HASH,WEB_MEDIA_ID} from '../src/lib/web-data';
export interface ResourceTicket {v:1;documentId:string;contentVersion:string;mediaId:string;sourceUrl:string;extractorVersion:string;}
export class HostedResourceTickets{
 private key:Buffer;
 constructor(private dir:string){
  if(!absolutePath(dir))throw new Error('Hosted state directory must be absolute');
  mkdirSync(dir,{recursive:true,mode:0o700});const info=lstatSync(dir);if(process.getuid&&info.uid!==process.getuid())throw new Error('Hosted state directory owner invalid');if(!info.isDirectory()||info.isSymbolicLink()||!privateMode(info.mode))throw new Error('Hosted state directory permissions invalid');
  const path=join(resolve(dir),'resource-signing.key');
  try{const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,randomBytes(32));fchmodSync(fd,0o600);fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(dir);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw new Error('Hosted signing key unavailable');}
  const stat=lstatSync(path);if(process.getuid&&stat.uid!==process.getuid())throw new Error('Hosted signing key owner invalid');if(!stat.isFile()||stat.isSymbolicLink()||!privateMode(stat.mode)||stat.size!==32)throw new Error('Hosted signing key invalid; recovery required');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{this.key=readFileSync(fd);if(this.key.length!==32)throw new Error('Invalid key');}finally{closeSync(fd);}
 }
 sign(value:ResourceTicket){this.validate(value);const payload=Buffer.from(JSON.stringify(value)).toString('base64url');return payload+'.'+createHmac('sha256',this.key).update(payload).digest('base64url');}
 verify(ticket:unknown):ResourceTicket{
  if(typeof ticket!=='string'||ticket.length>12000)throw new HostedError('图片来源票据无效',403,'web_ticket_invalid');
  const [payload,signature,...rest]=ticket.split('.');const actual=createHmac('sha256',this.key).update(payload||'').digest(),given=Buffer.from(signature||'','base64url');
  if(rest.length||given.length!==actual.length||!timingSafeEqual(actual,given))throw new HostedError('图片来源票据无效',403,'web_ticket_invalid');
  let value:ResourceTicket;try{value=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));this.validate(value);}catch{throw new HostedError('图片来源票据无效',403,'web_ticket_invalid');}return value;
 }
 private validate(v:ResourceTicket){if(!v||Object.keys(v).some(k=>!['v','documentId','contentVersion','mediaId','sourceUrl','extractorVersion'].includes(k))||v.v!==1||typeof v.documentId!=='string'||v.documentId.length>160||!WEB_HASH.test(v.contentVersion)||!WEB_MEDIA_ID.test(v.mediaId)||!safeWebUrl(v.sourceUrl)||typeof v.extractorVersion!=='string'||v.extractorVersion.length>200)throw new Error('Invalid resource ticket payload');}
}
