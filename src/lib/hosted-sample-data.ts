export interface HostedSample {id:string;title:string;filename:string;kind:'markdown'|'pdf';url:string;sha256:string;author:string;source?:string;license:string;modified:string;status?:'ready'|'pending'}
const files=new WeakMap<File,HostedSample>();
export function markSampleFile(file:File,sample:HostedSample){files.set(file,sample);return file;}
export function sampleForFile(file:File){return files.get(file);}
