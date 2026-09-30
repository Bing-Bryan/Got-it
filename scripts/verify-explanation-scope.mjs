// Opt-in real-model acceptance with synthetic scope examples; never records raw traces.
import { mkdir, writeFile } from 'node:fs/promises';
import { ProviderService, parseInquiryRequest } from '../server/providers.ts';
const outIndex=process.argv.indexOf('--out');
const out=outIndex>=0?process.argv[outIndex+1]:undefined;
if(!process.argv.includes('--run')||!out) { console.log('Use node --import tsx scripts/verify-explanation-scope.mjs --run --out <new-directory>');process.exit(0); }
await mkdir(out,{recursive:false});
const service=new ProviderService();
const samples=[
 {id:'age',quote:'18–34岁是行业主力',context:'安全合成查证题。原文唯一附带依据是某未具名产品的18–25岁用户样本。产品名、年份、样本量均未提供。这个样本能否直接证明整个行业18–34岁是主力？'},
 {id:'year',quote:'2025年全球电动车销量是2023年的两倍',context:'安全合成查证题。作者引用的是2023年中国市场的同比增长数据，没有提供2025年全球同口径统计。请检查能否用该资料直接支持原句。'}
];
const records=[];
for(const sample of samples){const started=performance.now();const request=parseInquiryRequest({providerId:'codex',intent:'verify',quote:sample.quote,context:sample.context,documentTitle:'安全合成口径验收',question:'检查这段原文的依据和口径',history:[]});let firstTextMs;try {const result=await service.answer(request,{onEvent:e=>{if(e.type==='answer-delta'&&firstTextMs===undefined)firstTextMs=performance.now()-started;}});records.push({sample,firstTextMs,totalMs:performance.now()-started,result});}catch(error){records.push({sample,firstTextMs,totalMs:performance.now()-started,error:error.message});}await writeFile(`${out}/results.json`,JSON.stringify(records,null,2));console.log(sample.id,records.at(-1).error??'complete');}
