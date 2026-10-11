// Socket-level macOS sandbox control test, independent of Playwright route hooks.
// Controlled local listener only. No real website or user service is contacted.
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const server=createServer(socket=>{accepted++;socket.on('error',()=>{});socket.end();});
let accepted=0;
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {port}=server.address();
const code=`const s=require('node:net').connect({host:'127.0.0.1',port:${port}});s.on('connect',()=>{console.log(JSON.stringify({connected:true}));s.destroy()});s.on('error',e=>{console.log(JSON.stringify({connected:false,code:e.code}));process.exitCode=2});s.setTimeout(2000,()=>{console.log(JSON.stringify({timeout:true}));s.destroy();process.exitCode=3});`;
try {
 for(const [label,profile] of [['native-control',null],['deny-ip','(version 1) (allow default) (deny network* (remote ip "*:*")) (deny network* (local ip "*:*"))']]){
  const dir=await mkdtemp(join(tmpdir(),'got-it-socket-probe-'));const before=accepted;
  const child=spawn(profile?'/usr/bin/sandbox-exec':process.execPath,profile?['-p',profile,process.execPath,'-e',code]:['-e',code],{cwd:dir,env:{PATH:'/usr/bin:/bin',HOME:dir,TMPDIR:dir},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);const result=await new Promise(resolve=>child.on('exit',(exitCode,signal)=>resolve({exitCode,signal})));
  console.log(JSON.stringify({label,...result,output:JSON.parse(output),serverAccepted:accepted-before}));
  await rm(dir,{recursive:true,force:true});
 }
} finally { await new Promise(resolve=>server.close(resolve)); }
