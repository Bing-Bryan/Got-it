// Controlled feasibility probe. No real website, credentials, reading library or personal browser.
// Usage: node scripts/web-capture-gate.mjs /tmp/.../node_modules/playwright/index.mjs /tmp/.../browsers
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const [dependency, browsers, mode] = process.argv.slice(2);
if (!dependency || !browsers) throw new Error('Pass isolated Playwright module and browsers paths');
const fixture = `<!doctype html><html><style>body{margin:0;background:#eef2ff}h1{font:24px sans-serif}#ball{width:70px;height:70px;background:#2563eb;border-radius:50%;animation:move 1s linear infinite alternate}@keyframes move{from{transform:translateX(10px)}to{transform:translateX(400px)}}</style><h1>Controlled HTML animation fixture</h1><div id="ball"></div></html>`;
if (mode) {
 const { chromium } = await import(pathToFileURL(resolve(dependency)).href);
 const started = performance.now();
 let browser;
 try {
  browser = await chromium.launch({ chromiumSandbox:true, headless:true, timeout:10000 });
  console.log(JSON.stringify({event:'launched',ms:Math.round(performance.now()-started),sandbox:true}));
  const videoDir = join(process.cwd(),'video'); await mkdir(videoDir,{recursive:true});
  const context = await browser.newContext({viewport:{width:640,height:360},recordVideo:{dir:videoDir,size:{width:640,height:360}},serviceWorkers:'block',acceptDownloads:false});
  let fixtureHttpRequests=0; context.on('request',r=>{if(/^https?:/.test(r.url())) fixtureHttpRequests++});
  const page = await context.newPage();
  // Synthetic fixture only: no remote navigation and no network interception relied on.
  await page.setContent(fixture);
  console.log(JSON.stringify({event:'fixture-ready',codec:await page.evaluate(()=>document.createElement('video').canPlayType('video/webm; codecs="vp8"'))}));
  if (mode === 'cancel') await new Promise(()=>{});
  await page.waitForTimeout(3000);
  const video = page.video(); await context.close();
  const file=await video.path(); const bytes=await readFile(file); await copyFile(file,join(process.cwd(),'synthetic-animation.webm'));
  const replay=await browser.newPage();
  const decoded=await replay.evaluate(async uri=>{
   const v=document.createElement('video');v.src=uri;v.muted=true;document.body.append(v);
   await new Promise((res,rej)=>{v.onloadeddata=res;v.onerror=()=>rej(new Error('decode failed'));setTimeout(()=>rej(new Error('decode timeout')),5000)});
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const c=canvas.getContext('2d');
   async function frame(t){v.currentTime=t;await new Promise(r=>v.onseeked=r);c.drawImage(v,0,0);return canvas.toDataURL();}
   const a=await frame(.3),b=await frame(.7);v.currentTime=0;await v.play();await new Promise(r=>setTimeout(r,600));v.pause();
   const played=v.currentTime;v.currentTime=0;await v.play();await new Promise(r=>setTimeout(r,200));v.pause();
   return {width:v.videoWidth,height:v.videoHeight,duration:v.duration,differentFrames:a!==b,playedSeconds:played,replayedSeconds:v.currentTime};
  },'data:video/webm;base64,'+bytes.toString('base64'));
  console.log(JSON.stringify({event:'recorded-and-replayed',bytes:bytes.length,elapsedMs:Math.round(performance.now()-started),fixtureHttpRequests,decoded}));
 } catch(e) { console.log(JSON.stringify({event:'failed',error:e.message})); process.exitCode=1; }
 finally { if(browser) await browser.close().catch(()=>{}); }
} else {
 const self=resolve(process.argv[1]); const node=process.execPath;
 async function run(label,profile,cancel=false){
  const dir=await mkdtemp(join(tmpdir(),'got-it-capture-probe-'));
  const args=[self,resolve(dependency),resolve(browsers),cancel?'cancel':'probe'];
  const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:dir,TMPDIR:dir,PLAYWRIGHT_BROWSERS_PATH:resolve(browsers),LANG:'en_US.UTF-8',DEBUG:'pw:browser'};
  const p=spawn(profile?'/usr/bin/sandbox-exec':node,profile?['-p',profile,node,...args]:args,{cwd:dir,env,detached:true,stdio:['ignore','pipe','pipe']});
  let output='',errors='',cancelAt;
  p.stdout.on('data',d=>{output+=d; if(cancel&&!cancelAt&&output.includes('fixture-ready')){cancelAt=performance.now();process.kill(-p.pid,'SIGTERM');}});
  p.stderr.on('data',d=>errors+=d);
  const timer=setTimeout(()=>{try{process.kill(-p.pid,'SIGKILL')}catch{}},20000);
  const result=await new Promise(r=>p.on('exit',(code,signal)=>r({code,signal})));
  clearTimeout(timer);
  await new Promise(resolve=>setTimeout(resolve,100));
  let processGroupAbsent=false; try{process.kill(-p.pid,0)}catch(e){processGroupAbsent=e.code==='ESRCH'}
  // Collect only synthetic fixture results and sandbox errors, no browser network logs.
  console.log(JSON.stringify({label,...result,processGroupAbsent,output:output.trim().split('\n').filter(Boolean).map(s=>{try{return JSON.parse(s)}catch{return s}}),sandboxErrors:errors.split('\n').filter(s=>s.includes('sandbox initialization failed')),cancelMs:cancelAt?Math.round(performance.now()-cancelAt):undefined}));
  if(label==='native-chromium-sandbox' && result.code===0) await copyFile(join(dir,'synthetic-animation.webm'),resolve('artifacts/web-reading/synthetic-animation.webm'));
  await rm(dir,{recursive:true,force:true});
  console.log(JSON.stringify({label,temporaryDirectoryRemoved:true}));
 }
 await run('native-chromium-sandbox',null);
 await run('cancel-process-group',null,true);
 await run('deny-all-network','(version 1) (allow default) (deny network*)');
 await run('deny-ip-network','(version 1) (allow default) (deny network* (remote ip "*:*")) (deny network* (local ip "*:*"))');
}
