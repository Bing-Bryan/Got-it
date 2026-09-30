// Opt-in experiment only. Does not change the app's explanation/search policy.
// node --import tsx scripts/measure-explanation-search.mjs --run --out <new-directory>
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderService, normalizeCodexResponse } from '../server/providers.ts';
import { runCodexTurn } from '../server/codex-stream.ts';
import { readCodexModels } from '../server/codex-models.ts';
import { resolveCodexBinary } from '../server/codex-runtime.ts';
import { parseSearchTrace } from '../server/search-trace.ts';
import { verifySources } from '../server/source-reader.ts';
import { modelConfig, supportsConfig } from '../src/lib/model-routing.ts';
import { INTENT_META } from '../src/types.ts';

const run = process.argv.includes('--run');
const config = modelConfig('explain');
const outputArg = process.argv.indexOf('--out');
const output = outputArg >= 0 ? process.argv[outputArg + 1] : undefined;
if (run && !output) throw Error('--run requires --out pointing to a new evidence directory');

const samples = [
  { id: 'cagr', label: '常见概念 CAGR', quote: 'CAGR', context: '合成报告：一个市场规模从2023年的100增长到2025年的121，报告用CAGR描述这两年的平均增长速度。' },
  { id: 'defined-term', label: '原文已定义的虚构术语', quote: '晴刻率', context: '合成材料，术语为虚构：本文把一分钟内灯亮的秒数占60秒的比例称为“晴刻率”。灯亮30秒时，晴刻率为50%。这里只需要理解作者在本文中的定义。' },
  { id: 'acp', label: '外部技术概念 ACP', quote: 'Agent Client Protocol（ACP）', context: '合成产品分析：编辑器可通过Agent Client Protocol（ACP）接入不同编程智能体，而不必为每个智能体重写一套交互。这里的ACP连接的是哪两方？它与MCP有什么区别？' },
];
const offlineAccess = '本次不是联网核查：只能使用下方提供的选区、邻近上下文和追问历史，不要联网或访问本地文件、工作区、环境变量或令牌，不要修改任何文件，也不要创建持久会话。';
const onlineAccess = '本次是联网辅助概念解释：必须实际执行搜索并打开相关来源，优先原始定义或官方文档，最多返回2条有用来源。不无限搜索。解释仍只处理选区含义、原文中的作用和具体例子，不改成事实查证裁决。本文自定义术语须以本文定义为准，不强行改成网上同名词；没有可靠外部定义就明确说明。不凭链接或自身声称表示搜索成功。禁止访问本地文件、工作区、环境变量或令牌，禁止修改任何文件，也不要创建持久会话。';
const offlineOutput = '概念解释包括通俗定义、具体例子和上下文含义；介绍实体包括是什么、做什么、与文章的关系。未知事实明确不确定。verification 返回 null，sources 返回空数组。';
const onlineOutput = '概念解释包括通俗定义、具体例子和上下文含义；介绍实体包括是什么、做什么、与文章的关系。未知事实明确不确定。verification 返回 null，sources 只返回本次实际使用的来源，无法提供时返回空数组。';

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, 'Production prompt changed; review the experiment before running');
  return text.replace(before, after);
}

// Capture the real production prompt/schema without making a model call.
// This controlled preparation is not counted as a successful real request.
async function prepare(sample) {
  let captured;
  const catalog = [{...config, displayName:config.model, description:'controlled prompt capture', defaultReasoningEffort:config.reasoningEffort, supportedReasoningEfforts:[{reasoningEffort:config.reasoningEffort,description:''}], isDefault:true}];
  const service = new ProviderService({ modelCatalog:async()=>catalog,
    execFileImpl:async()=>({stdout:'Logged in using ChatGPT',stderr:''}),
    codexTurnImpl:async options=>{captured={prompt:options.prompt,schema:options.schema};return {raw:JSON.stringify({answer:'controlled prompt capture',verification:null,evidenceStatus:'not-applicable',sources:[]}),trace:''};},
  });
  const request = {providerId:'codex',intent:'explain',documentTitle:'公开合成对照材料.md',quote:sample.quote,context:sample.context,question:INTENT_META.explain.prompt(sample.quote),history:[],modelConfig:config};
  await service.answer(request,{onEvent(){}});
  assert.ok(captured);
  const onlinePrompt = replaceOnce(replaceOnce(captured.prompt,offlineAccess,onlineAccess),offlineOutput,onlineOutput);
  assert.ok(!onlinePrompt.includes('sources 返回空数组'));
  return {request,schema:captured.schema,prompts:{offline:captured.prompt,online:onlinePrompt}};
}

const prepared = new Map();
for (const sample of samples) prepared.set(sample.id,await prepare(sample));
if (!run) {
  console.log('PASS: 3 synthetic samples use the production prompt/schema; online policy changes match exactly. No real model calls. Add --run --out <new-directory> to measure.');
  process.exit(0);
}
await mkdir(output,{recursive:true});
try { await access(join(output,'results.json')); throw Error('Refusing to overwrite existing results'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const binary = resolveCodexBinary(process.env.CODEX_CLI_PATH);
const models = await readCodexModels(binary);
assert.ok(supportsConfig(models,config),'The selected model/effort is not currently available; do not silently substitute');
const records = [];
const metadata = {startedAt:new Date().toISOString(),modelConfig:config,repeats:2,synthetic:true,
  measurement:'Sequential real model turns, alternating offline/online then online/offline per sample. Timer starts before spawning the per-turn app-server, after prompt preparation and model discovery. Excludes browser/HTTP/login status checks. Includes optional post-turn public-source checking as a separate metric.',
  limitation:'Exploratory 12-call sample. Network/model load, service-side caches and model nondeterminism are uncontrolled. The online explanation is an experimental prompt/tool variant, not a shipped UI feature.',
  samples,records};
await writeFile(join(output,'schema.json'),JSON.stringify(prepared.get(samples[0].id).schema,null,2)+'\n');
await mkdir(join(output,'prompts'),{recursive:true});
for (const [id,entry] of prepared) for (const mode of ['offline','online']) await writeFile(join(output,'prompts',`${id}-${mode}.txt`),entry.prompts[mode]+'\n');
await writeFile(join(output,'results.json'),JSON.stringify(metadata,null,2)+'\n');

for (let repeat=1;repeat<=2;repeat++) for (const sample of samples) for (const mode of repeat===1 ? ['offline','online'] : ['online','offline']) {
  const entry=prepared.get(sample.id);
  const cwd=await mkdtemp(join(tmpdir(),'got-it-explanation-ab-'));
  const record={id:sample.id,mode,repeat,status:'running',firstTextMs:null,lastTextMs:null,modelCompleteMs:null,resultsReadyMs:null,sourceCheckMs:0,deltaEvents:0};
  const start=performance.now();
  try {
    const result=await runCodexTurn({binary,cwd,config,prompt:entry.prompts[mode],schema:entry.schema,searchable:mode==='online',timeoutMs:120000,
      onDelta(delta){if(delta.trim() && record.firstTextMs===null)record.firstTextMs=Math.round(performance.now()-start);record.lastTextMs=Math.round(performance.now()-start);record.deltaEvents++;},onTrace(){}});
    record.modelCompleteMs=Math.round(performance.now()-start);
    const response=normalizeCodexResponse(result.raw,entry.request);
    record.answer=response.answer;
    record.answerCharacters=Array.from(response.answer).length;
    record.search=parseSearchTrace(result.trace);
    record.status=mode==='online' && record.search.status!=='executed' ? 'search-unconfirmed' : 'completed';
    const checkedAt=performance.now();
    const checked=mode==='online' ? await verifySources(response.sources) : response.sources;
    record.sourceCheckMs=mode==='online' ? Math.round(performance.now()-checkedAt) : 0;
    record.sources=checked.map(({title,url,snippet,retrievalStatus,excerptKind})=>({title,url,snippet,retrievalStatus,excerptKind}));
    record.resultsReadyMs=Math.round(performance.now()-start);
  } catch(error) {
    record.status=error?.code==='ETIMEDOUT' ? 'timeout' : 'failed';
    record.elapsedMs=Math.round(performance.now()-start);
    // Avoid printing/saving raw child-process errors or traces.
    record.errorCode=error?.code==='ETIMEDOUT' ? 'ETIMEDOUT' : 'request_failed';
  } finally {
    await rm(cwd,{recursive:true,force:true});
  }
  records.push(record);
  await writeFile(join(output,'results.json'),JSON.stringify(metadata,null,2)+'\n');
  console.log(JSON.stringify({id:record.id,mode,repeat,status:record.status,firstTextMs:record.firstTextMs,lastTextMs:record.lastTextMs,modelCompleteMs:record.modelCompleteMs,resultsReadyMs:record.resultsReadyMs,search:record.search?.status,sourceCount:record.sources?.length}));
}
metadata.finishedAt=new Date().toISOString();
await writeFile(join(output,'results.json'),JSON.stringify(metadata,null,2)+'\n');
