import express from 'express';
import type {InquiryEvent} from '../src/types';
import {HostedBudget, HostedError, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS} from './hosted-budget';
import {HOSTED_MODEL, parseHostedInquiry, usesHostedSearch, type HostedRunner} from './hosted-model';
import {requestDeadline} from '../src/lib/request-deadline';
import type {HostedWebImports} from './hosted-web-imports';
import {hostedOperationToken} from './hosted-web-imports';
import type {HostedTranslations} from './hosted-translations';
import {WebError} from './web-fetch';
import type {HostedStatistics} from './hosted-statistics';

export interface HostedOptions {origin:string;budget:HostedBudget;runner?:HostedRunner;verificationRunner?:HostedRunner;searchCostUsd?:number;webImports?:HostedWebImports;translations?:HostedTranslations;statistics?:HostedStatistics;timeoutMs?:number;images?:boolean;}
export function createHostedApp(options:HostedOptions) {
  const app=express();
  const verificationAvailable=!!options.verificationRunner&&Number.isFinite(options.searchCostUsd)&&options.searchCostUsd!>0;
  app.disable('x-powered-by');
  // The API binds only to loopback. The production reverse proxy MUST overwrite
  // X-Forwarded-For; forwarded chains from non-loopback clients are never trusted.
  app.set('trust proxy','loopback');
  app.use((req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Vary','Origin');
    const sameOriginGet=req.method==='GET'&&!req.get('origin')&&req.get('sec-fetch-site')==='same-origin'&&req.get('host')===new URL(options.origin).host;
    if(req.get('origin')!==options.origin&&!sameOriginGet){res.status(403).json({error:'请求来源不允许',code:'origin_rejected'});return;}
    res.setHeader('Access-Control-Allow-Origin',options.origin);
    res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Trial-Id, X-Hosted-Operation-Token');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    if(req.method==='OPTIONS'){res.sendStatus(204);return;}
    if(req.headers.authorization||req.headers['x-api-key']||req.headers['api-key']){res.status(400).json({error:'体验版不接受用户密钥',code:'user_key_rejected'});return;}
    next();
  });
  const ordinaryJson=express.json({limit:'40kb',strict:true}),captureJson=express.json({limit:'2mb',strict:true}),translationJson=express.json({limit:'160kb',strict:true}),imageJson=express.json({limit:'6mb',strict:true});
  // Only the inquiry route accepts a selected-region image, and only when reading images is enabled.
  const imagesEnabled=!!options.images&&!!options.runner;
  // Check quota before parsing a large image body, so a client whose allowance is used up
  // cannot keep forcing multi-megabyte parses.
  const imageBody:express.RequestHandler=(req,res,next)=>{
    try{const q=options.budget.status(identity(req),ip(req));
      if(q.remaining<=0||q.globalExhausted){res.status(429).json({error:q.globalExhausted?'今日体验额度已用完':'今日体验次数已用完',code:q.globalExhausted?'global_quota_exhausted':'quota_exhausted'});return;}}
    catch(error){next(error);return;}
    imageJson(req,res,next);
  };
  app.use((req,res,next)=>(req.path==='/api/hosted/x-article-imports'?captureJson:req.path==='/api/hosted/translation-batches'?translationJson:req.path==='/api/hosted/inquiry/stream'&&imagesEnabled?imageBody:ordinaryJson)(req,res,next));
  function validateIdentity(id:unknown){if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new HostedError('体验标识无效');return id;}
  const identity=(req:express.Request)=>validateIdentity(req.get('x-trial-id'));
  const ip=(req:express.Request)=>req.ip||req.socket.remoteAddress||'unknown';
  const operationToken=(req:express.Request)=>hostedOperationToken(req.get('x-hosted-operation-token'));
  const emptyBody=(req:express.Request)=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length)throw new HostedError('操作请求字段无效');};
  const withDisconnect=async<T>(res:express.Response,run:(signal:AbortSignal)=>Promise<T>)=>{const c=new AbortController(),close=()=>{if(!res.writableEnded)c.abort(new Error('连接已停止'));};res.on('close',close);try{return await run(c.signal);}finally{res.off('close',close);}};
  if(options.webImports){
    for(const [path,x]of [['web-imports',false],['x-article-imports',true]] as const)app.post(`/api/hosted/${path}`,async(req,res,next)=>{try{res.json(await options.webImports!.start(identity(req),ip(req),operationToken(req),req.body,x));}catch(e){next(e);}});
    app.get('/api/hosted/web-imports/:op',(req,res,next)=>{try{res.json(options.webImports!.status(identity(req),String(req.params.op),operationToken(req)));}catch(e){next(e);}});
    app.get('/api/hosted/web-imports/:op/resources/:id',(req,res,next)=>{try{const r=options.webImports!.resource(identity(req),String(req.params.op),operationToken(req),String(req.params.id));res.set({'Content-Type':r.mime,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).send(r.bytes);}catch(e){next(e);}});
    for(const action of ['cancel','release'] as const)app.post(`/api/hosted/web-imports/:op/${action}`,(req,res,next)=>{try{emptyBody(req);res.json(options.webImports![action](identity(req),String(req.params.op),operationToken(req)));}catch(e){next(e);}});
    app.post('/api/hosted/web-media/retry',async(req,res,next)=>{try{res.json(await withDisconnect(res,signal=>options.webImports!.retry(identity(req),ip(req),operationToken(req),req.body,signal)));}catch(e){next(e);}});
  }
  if(options.translations){
    app.post('/api/hosted/translation-batches',async(req,res,next)=>{try{res.json(await withDisconnect(res,signal=>options.translations!.batch(identity(req),ip(req),operationToken(req),req.body,signal)));}catch(e){next(e);}});
    app.post('/api/hosted/translation-batches/:op/cancel',(req,res,next)=>{try{emptyBody(req);res.json(options.translations!.cancel(identity(req),String(req.params.op),operationToken(req)));}catch(e){next(e);}});
  }
  app.get('/api/hosted/capabilities',(req,res,next)=>{try{res.json({model:HOSTED_MODEL,providerId:'deepseek',supportsImages:imagesEnabled,supportsWebImport:!!options.webImports,supportsXCapture:!!options.webImports,supportsWebMediaRetry:!!options.webImports,supportsTranslation:!!options.translations,supportsWebSearch:verificationAvailable,searchAvailable:verificationAvailable,searchProvider:'bocha',available:!!options.runner,quota:options.budget.status(identity(req),ip(req))});}catch(e){next(e);}});
  app.post('/api/hosted/inquiry/stream',async(req,res,next)=>{
    let settle:ReturnType<HostedBudget['reserve']>|undefined;
    let budget:ReturnType<typeof requestDeadline>|undefined;
    let sequence=0,finished=false;
    const id=typeof req.body?.requestId==='string'?req.body.requestId:'';
    const emit=(event:Omit<InquiryEvent,'requestId'|'sequence'>)=>{if(!res.destroyed&&!finished)res.write(JSON.stringify({...event,requestId:id,sequence:++sequence})+'\n');};
    const cancel=new AbortController();
    const close=()=>{if(!res.writableEnded)cancel.abort(new Error('请求已停止'));};
    res.on('close',close);
    try{
      const request=parseHostedInquiry(req.body,{images:imagesEnabled});
      const trialId=identity(req);
      if(usesHostedSearch(request)&&!verificationAvailable)throw new HostedError('联网搜索服务暂未配置，请稍后重试',503,'search_unavailable');
      if(!options.runner)throw new HostedError('体验模型尚未配置',503,'model_unavailable');
      budget=requestDeadline(Math.min(60_000,options.timeoutMs??60_000),cancel.signal);
      settle=options.budget.reserve(trialId,ip(req),usesHostedSearch(request)?options.searchCostUsd??NaN:0,request.hostedImage?{input:MAX_INPUT_TOKENS+request.hostedImage.tokens,output:MAX_OUTPUT_TOKENS}:undefined);
      res.status(200).set({'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'});res.flushHeaders();
      emit({type:'progress',progress:'accepted',deadlineAt:budget.deadlineAt});
      const runner=usesHostedSearch(request)?options.verificationRunner!:options.runner;
      const result=await budget.wait(runner(request,budget.signal,delta=>{budget!.check();emit({type:'answer-delta',delta});},progress=>{budget!.check();emit({type:'progress',progress});}));
      budget.check();
      settle(result.usage);
      budget.check();
      emit({type:'complete',response:result.response});finished=true;res.end();
    }catch(error){
      // Provider errors may contain request bodies, URLs or credentials. Never
      // serialize or log raw errors from SDKs.
      // Content-free schema diagnostics make structured-output failures traceable in production.
      const diagnostic=(error as {schemaDiagnostic?:unknown})?.schemaDiagnostic;if(diagnostic)console.warn(JSON.stringify({event:'model_schema_invalid',diagnostic}));
      const safe=error instanceof HostedError?error:new HostedError(budget?.signal.aborted?(cancel.signal.aborted?'请求已停止':'本次请求超时，请重试'):'模型服务失败，请重试',502,budget?.signal.aborted?'request_interrupted':'model_failed');
      if(res.headersSent){emit({type:'error',error:safe.message,...(safe.code==='search_failed'?{response:{answer:'',sources:[],evidenceStatus:'not-applicable' as const,mode:'live' as const,providerId:'deepseek' as const,providerName:'体验版默认模型',model:HOSTED_MODEL,search:{status:'failed' as const,completedSearches:0,failedSearches:1}}}:{})});finished=true;res.end();}else next(safe);
    }finally{settle?.();budget?.dispose();res.off('close',close);}
  });
  app.post('/api/hosted/usage',(req,res,next)=>{try{let summary=req.body,id:string;if(req.get('x-trial-id')){id=identity(req);}else{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length!==2||!Object.keys(req.body).every(k=>['experienceId','summary'].includes(k)))throw new HostedError('统计传输格式无效');id=validateIdentity(req.body.experienceId);summary=req.body.summary;}if(!options.statistics)throw new HostedError('统计暂不可用',503);options.statistics.record(summary,id,ip(req));res.sendStatus(204);}catch(e){next(e);}});
  app.use((_req,res)=>{res.status(404).json({error:'接口不存在',code:'not_found'});});
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    const bodyTooLarge=!!error&&typeof error==='object'&&'type' in error&&error.type==='entity.too.large';
    const safe=error instanceof HostedError?error:error instanceof WebError?new HostedError(error.message,error.status,error.code):bodyTooLarge?new HostedError('请求体超过允许容量',413,'body_limit'):new HostedError('请求格式错误',400,'invalid_request');
    if(!res.headersSent)res.status(safe.status).json({error:safe.message,code:safe.code});
  });
  return app;
}
