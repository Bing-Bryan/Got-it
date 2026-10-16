import {collectWebAnchorText,type WebAnchorProjection} from './web-anchor-compat';
import {missingWebMediaHtml,mediaLegacyAttribute,stripWebCompatAttributes} from './web-media-markup';
import { marked, Renderer } from 'marked';
import { parseFragment, serialize, defaultTreeAdapter, type DefaultTreeAdapterMap } from 'parse5';
import { stableHash } from '../sample';
import { copyModelConfig, type ModelConfig } from './model-routing';
import type { WebDocumentData } from './web-data';
type Node=DefaultTreeAdapterMap['node'];type Element=DefaultTreeAdapterMap['element'];type Text=DefaultTreeAdapterMap['textNode'];
export const TRANSLATION_CONTRACT_VERSION=2 as const;
/** New-response quality epoch; persisted structure/unit identities remain v2. */
export const TRANSLATION_QUALITY_VERSION=3 as const;
export const TRANSLATION_PLACEHOLDER=/\[GOTIT_(?:OPEN|CLOSE|KEEP)_\d+\]/g;
export const TRANSLATION_LIMITS={units:64,inputChars:12_000,unitChars:4000,outputChars:48_000,callMs:120_000,roundMs:600_000} as const;
/** New scheduling target; the API hard limits above remain compatible. */
export const TRANSLATION_BATCH_TARGET={units:16,inputChars:4000} as const;
export interface TranslationSelection {version?:1|2;translationId:string;sourceVersion:string;blockId:string;quote:string;prefix:string;suffix:string;start:number;end:number}
export interface WebTranslationState {version:2;id:string;target:'zh';documentId:string;sourceVersion:string;status:'partial'|'complete'|'interrupted'|'failed';batchEpoch?:number;modelConfig:ModelConfig;modelConfigsUsed?:ModelConfig[];units:Record<string,string>;updatedAt:string;error?:string}
export interface TranslationUnit {id:string;blockId:string;text:string;structureContext?:{before:string[];after:string[]}}
export interface TranslationBlock {id:string;text:string;headingPath:string[];tag:string;legacy?:WebAnchorProjection}
export interface TranslationSource {html:string;blocks:TranslationBlock[];units:TranslationUnit[]}
export interface TranslationBatchResult {repairCount?:number;operationId:string;translationId:string;sourceVersion:string;modelConfig:ModelConfig;units:Record<string,string>}
const isElement=(n:Node):n is Element=>'tagName'in n;
const children=(n:Node):Node[]=>'childNodes'in n?n.childNodes:[];
const textOf=(n:Node):string=>n.nodeName==='#text'?(n as Text).value:children(n).map(textOf).join('');
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const tags=new Set(['h1','h2','h3','h4','h5','h6','p','li','pre','td','th']);
const protectedPattern=/(?:https?:\/\/|www\.)[^\s<>]+|\b(?:mailto:)[^\s<>]+|\[GOTIT_(?:(?:OPEN|CLOSE|KEEP)_)?\d+\]/gi;
function placeholders(s:string):string[]{return s.match(TRANSLATION_PLACEHOLDER)??[];}
export function validPlaceholderStructure(original:string,translated:string,context?:TranslationUnit['structureContext']):boolean{
 const expected=placeholders(original),actual=placeholders(translated);if(expected.length!==actual.length||new Set(actual).size!==actual.length||actual.some(token=>!expected.includes(token)))return false;
 const source=[...(context?.before??[]),...expected,...(context?.after??[])],output=[...(context?.before??[]),...actual,...(context?.after??[])];
 const parent=new Map<string,string>(),closeOwner=new Map<string,string>(),stack:string[]=[];
 for(const token of source){if(token.startsWith('[GOTIT_CLOSE_')){const owner=stack.pop();if(!owner)return false;closeOwner.set(token,owner);}else{parent.set(token,stack.at(-1)??'root');if(token.startsWith('[GOTIT_OPEN_'))stack.push(token);}}
 if(stack.length)return false;for(const token of output){if(token.startsWith('[GOTIT_CLOSE_')){if(stack.pop()!==closeOwner.get(token))return false;}else{if((stack.at(-1)??'root')!==parent.get(token))return false;if(token.startsWith('[GOTIT_OPEN_'))stack.push(token);}}return stack.length===0;
}
/** Exact per-unit tokens plus whole-source owners for split fragments. */
export function translationStructure(unit:TranslationUnit){
 const tokens=placeholders(unit.text),before=unit.structureContext?.before??[],after=unit.structureContext?.after??[],stack:string[]=[],pairs:Array<{open:string;close:string}>=[],parents:Record<string,string>={};
 for(const token of [...before,...tokens,...after]){if(token.startsWith('[GOTIT_CLOSE_')){const open=stack.pop();if(open)pairs.push({open,close:token});}else{parents[token]=stack.at(-1)??'root';if(token.startsWith('[GOTIT_OPEN_'))stack.push(token);}}
 return {tokens,pairs,parents,...(before.length||after.length?{context:{before,after}}:{})};
}
export function friendlyTranslationError(message:string):string{return message.includes('安全诊断：')?'本批译文排版或内容校验失败，已有译文保留，可主动续译。':message;}
export function unitTranslationIssue(unit:TranslationUnit,value:unknown,skipStructure=false):string|undefined {
 if(typeof value!=='string'||!value.trim())return 'empty';
 if(value.length>Math.min(TRANSLATION_LIMITS.outputChars,unit.text.length*6+1024))return 'size';
 if(!skipStructure&&!validPlaceholderStructure(unit.text,value,unit.structureContext))return 'placeholders';
 if(/(?:https?:\/\/|www\.|mailto:)/i.test(value))return 'url';
 const prose=unit.text.replace(TRANSLATION_PLACEHOLDER,'');if(prose.length>=60&&(prose.match(/[A-Za-z]{2,}/g)??[]).length>=6&&!/[\u3400-\u9fff]/.test(value))return 'not_chinese';
}
export function validUnitTranslation(unit:TranslationUnit,value:unknown):value is string {return unitTranslationIssue(unit,value)===undefined;}
function newResponseIssue(unit:TranslationUnit,value:unknown,skipStructure=false):string|undefined{
 const issue=unitTranslationIssue(unit,value,skipStructure);if(issue||typeof value!=='string')return issue;
 const prose=unit.text.replace(TRANSLATION_PLACEHOLDER,''),output=value.replace(TRANSLATION_PLACEHOLDER,'');
 const letters=(prose.match(/\p{L}/gu)??[]).length,han=(prose.match(/[\u3400-\u9fff]/g)??[]).length;
 const foreign=/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/gu;
 const sourceForeign=(prose.match(foreign)??[]).length;
 if(prose.trim().length<60||letters-han<20||han/Math.max(1,letters)>=.8&&sourceForeign<20)return;
 if(!/[\u3400-\u9fff]/.test(output))return'not_chinese';
 const normal=(v:string)=>v.normalize('NFKC').replace(/\s+/g,' ').trim();
 if(normal(prose)===normal(output))return'untranslated';
 const compact=(v:string)=>v.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,''),a=compact(prose),b=compact(output);let prefix=0,suffix=0;while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;while(suffix<Math.min(a.length,b.length)-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
 if((sourceForeign>=20||han/Math.max(1,letters)<.3)&&a.length>=40&&prefix+suffix>=a.length*.95&&b.length<=a.length*1.2+8)return'untranslated';
 const outputForeign=(output.match(foreign)??[]).length,outputHan=(output.match(/[\u3400-\u9fff]/g)??[]).length;
 if(sourceForeign>=30&&outputForeign>=sourceForeign*.9&&outputHan<sourceForeign*.2)return'untranslated';
}
function batchQualityIssue(units:TranslationUnit[],values:string[],mode:'current'|'legacy'):string|undefined{
 const output=values.join('');
 if(units.reduce((n,u)=>n+u.text.length,0)>=200&&units.reduce((n,u)=>n+(u.text.match(/[A-Za-z]{2,}/g)??[]).length,0)>=20&&!/[\u3400-\u9fff]/.test(output))return'english_batch';
 if(mode==='current'){const prose=units.map(u=>u.text.replace(TRANSLATION_PLACEHOLDER,'')).join(' '),letters=(prose.match(/\p{L}/gu)??[]).length,han=(prose.match(/[\u3400-\u9fff]/g)??[]).length;if(prose.length>=200&&letters-han>=60&&!/[\u3400-\u9fff]/.test(output))return'not_chinese';}
 if(values.reduce((n,s)=>n+s.length,0)>TRANSLATION_LIMITS.outputChars)return'output_size';
}
/** Recovery eligibility checks every row and every non-structure rule, without diagnostic truncation. */
export function placeholderRepairUnits(units:TranslationUnit[],value:unknown):TranslationUnit[]{
 if(!Array.isArray(value)||value.length!==units.length)return [];
 const known=new Map(units.map(u=>[u.id,u])),seen=new Set<string>(),failed:TranslationUnit[]=[],values:string[]=[];
 for(const row of value){const unit=known.get(row?.id);if(!unit||seen.has(row.id)||newResponseIssue(unit,row.text,true))return [];seen.add(row.id);values.push(row.text);if(!validPlaceholderStructure(unit.text,row.text,unit.structureContext)){if(!validPlaceholderStructure(unit.text,unit.text,unit.structureContext))return [];failed.push(unit);}}
 if(seen.size!==units.length||batchQualityIssue(units,values,'current'))return [];
 return failed;
}
export function translationBatchDiagnostic(units:TranslationUnit[],value:unknown,mode:'current'|'legacy'='current',issueLimit=16){
 const rows=Array.isArray(value)?value:[],known=new Map(units.map(u=>[u.id,u])),seen=new Set<string>(),issues:Array<{id:string;reason:string}>=[];
 for(const row of rows){const id=row&&typeof row.id==='string'&&known.has(row.id)?row.id:'unknown';if(id==='unknown'){issues.push({id,reason:'unknown_id'});continue;}if(seen.has(id))issues.push({id,reason:'duplicate'});seen.add(id);const reason=(mode==='current'?newResponseIssue:unitTranslationIssue)(known.get(id)!,row.text);if(reason)issues.push({id,reason});}
 for(const u of units)if(!seen.has(u.id))issues.push({id:u.id,reason:'missing'});
 if(!issues.length&&rows.length===units.length){const reason=batchQualityIssue(units,rows.map(row=>row.text),mode);if(reason)issues.push({id:'batch',reason});}
 return{expected:units.length,received:rows.length,issues:issues.slice(0,issueLimit)};
}

function visit(n:Node,fn:(n:Node)=>void){fn(n);for(const c of children(n))visit(c,fn);}
function sourceTree(markdown:string,web:WebDocumentData){const media=new Map(web.media.map(m=>[m.id,m]));const r=new Renderer();r.html=({text})=>stripWebCompatAttributes(text);r.image=({href,text})=>{const m=media.get(href.replace(/^got-it-media:/,''));if(!m)return `<span class="image-unavailable">图片未获授权：${esc(text)}</span>`;if(m.status!=='saved')return missingWebMediaHtml(m);return `<img${mediaLegacyAttribute(m)} data-web-media="${esc(m.id)}" tabindex="0" role="button" aria-label="放大查看：${esc(m.alt||'静态图片或图表')}" alt="${esc(m.alt)}"${m.width?` width="${m.width}"`:''}${m.height?` height="${m.height}"`:''}>`;};return parseFragment(marked.parse(markdown,{async:false,gfm:true,breaks:false,renderer:r}) as string);}

type ProtectedToken={kind:'open'|'close'|'keep';node?:Node;text?:string};
function splitTemplate(template:string){const parts:string[]=[];let rest=template;while(rest.length>TRANSLATION_LIMITS.unitChars){let cut=rest.lastIndexOf(' ',TRANSLATION_LIMITS.unitChars);if(cut<TRANSLATION_LIMITS.unitChars/2)cut=TRANSLATION_LIMITS.unitChars;const open=rest.lastIndexOf('[GOTIT_',cut);if(open>=0&&rest.indexOf(']',open)>=cut)cut=open;parts.push(rest.slice(0,cut));rest=rest.slice(cut);}parts.push(rest);return parts;}
function recipe(block:Element){let sequence=0;const tokens=new Map<string,ProtectedToken>();const token=(kind:ProtectedToken['kind'],node?:Node,text?:string)=>{const id=`[GOTIT_${kind.toUpperCase()}_${sequence++}]`;tokens.set(id,{kind,node,text});return id;};
 const encode=(n:Node):string=>{if(n.nodeName==='#text')return(n as Text).value.replace(protectedPattern,text=>token('keep',undefined,text));if(!isElement(n))return'';if(n.attrs.some(a=>a.name==='data-block-id')||['pre','code','img','br','hr'].includes(n.tagName)||n.attrs.some(a=>a.name==='class'&&a.value.includes('image-unavailable')))return token('keep',n);return token('open',n)+children(n).map(encode).join('')+token('close',n);};
 return{template:children(block).map(encode).join(''),tokens};
}
function webText(node:Node){return collectWebAnchorText(node,{children,text:n=>n.nodeName==='#text'?(n as Text).value:null,legacy:n=>isElement(n)?n.attrs.find(a=>a.name==='data-web-legacy-text')?.value:undefined});}
function setLegacy(node:Element){const legacy=webText(node).legacy;node.attrs=node.attrs.filter(a=>a.name!=='data-web-anchor-legacy');if(legacy)node.attrs.push({name:'data-web-anchor-legacy',value:JSON.stringify(legacy)});return legacy;}
function buildTree(markdown:string,web:WebDocumentData){const tree=sourceTree(markdown,web);const prune=(n:Node)=>{if('childNodes'in n)n.childNodes=n.childNodes.filter(c=>!isElement(c)||!['script','style','iframe','object','embed','svg','video','audio','source','link','meta'].includes(c.tagName));for(const c of children(n))prune(c);};prune(tree);const blocks:TranslationBlock[]=[],elements:Element[]=[];const stack:string[]=[];let section=0;
 visit(tree,n=>{if(!isElement(n)||!tags.has(n.tagName))return;const raw=textOf(n),text=clean(raw),projection=webText(n),id=`block-${blocks.length}-${stableHash(`${n.tagName}:${clean(projection.legacy?.text??raw)}`).slice(0,7)}`;if(/^h[1-6]$/.test(n.tagName)){const level=Number(n.tagName[1]);stack.length=level-1;stack[level-1]=text;n.attrs.push({name:'id',value:`section-${section++}-${stableHash(text).slice(0,6)}`});}blocks.push({id,text:n.tagName==='pre'?raw:raw.replace(/==([^=\n]+)==/g,'$1'),headingPath:stack.filter(Boolean),tag:n.tagName});elements.push(n);n.attrs.push({name:'data-block-id',value:id},{name:'data-heading-path',value:JSON.stringify(stack.filter(Boolean))});});
 const strip=(n:Node,excluded=false)=>{excluded||=isElement(n)&&['pre','code'].includes(n.tagName);if(n.nodeName==='#text'&&!excluded)(n as Text).value=(n as Text).value.replace(/==([^=\n]+)==/g,'$1');for(const c of children(n))strip(c,excluded);};strip(tree);for(const [index,element] of elements.entries()){const legacy=setLegacy(element);if(legacy)blocks[index].legacy=legacy;}
 const units:TranslationUnit[]=[];for(const element of elements){if(element.tagName==='pre')continue;const id=element.attrs.find(a=>a.name==='data-block-id')!.value,{template}=recipe(element);if(!template.replace(TRANSLATION_PLACEHOLDER,'').trim())continue;let offset=0;splitTemplate(template).forEach((text,index)=>{const before=placeholders(template.slice(0,offset));offset+=text.length;const after=placeholders(template.slice(offset));units.push({id:`${id}--v2-part${index}`,blockId:id,text,...(before.length||after.length?{structureContext:{before,after}}:{})});});}return{tree,blocks,units};}
export function buildTranslationSource(markdown:string,web:WebDocumentData):TranslationSource{const p=buildTree(markdown,web);return{html:serialize(p.tree),blocks:p.blocks,units:p.units};}
export function renderTranslatedHtml(source:TranslationSource,translations:Record<string,string>):string{const tree=parseFragment(source.html),elements:Element[]=[];visit(tree,n=>{if(isElement(n)&&n.attrs.some(a=>a.name==='data-block-id'))elements.push(n);});
 // Children are restored first; parent KEEP nodes then carry the already restored child block.
 for(const block of elements.reverse()){const id=block.attrs.find(a=>a.name==='data-block-id')!.value,units=source.units.filter(u=>u.blockId===id);if(!units.length)continue;const{template,tokens}=recipe(block);const parts=splitTemplate(template);if(parts.length!==units.length)continue;const output=units.map((u,i)=>validUnitTranslation(u,translations[u.id])?translations[u.id]:parts[i]).join('');if(!validPlaceholderStructure(template,output))continue;
  const fragment=parseFragment('');const stack:Array<DefaultTreeAdapterMap['parentNode']>=[fragment];const appendText=(value:string)=>defaultTreeAdapter.insertText(stack[stack.length-1],value);let at=0;for(const match of output.matchAll(TRANSLATION_PLACEHOLDER)){appendText(output.slice(at,match.index));const protectedNode=tokens.get(match[0])!;if(protectedNode.kind==='keep'){if(protectedNode.node){defaultTreeAdapter.detachNode(protectedNode.node as DefaultTreeAdapterMap['childNode']);defaultTreeAdapter.appendChild(stack[stack.length-1],protectedNode.node as DefaultTreeAdapterMap['childNode']);}else appendText(protectedNode.text??'');}else if(protectedNode.kind==='open'){const original=protectedNode.node as Element,element=defaultTreeAdapter.createElement(original.tagName,original.namespaceURI,original.attrs.map(a=>({...a})));defaultTreeAdapter.appendChild(stack[stack.length-1],element);stack.push(element);}else{if(stack.length<=1)throw new Error('受保护结构不完整。');stack.pop();}at=match.index!+match[0].length;}appendText(output.slice(at));if(stack.length!==1)throw new Error('受保护结构不完整。');block.childNodes=[];for(const child of [...fragment.childNodes]){defaultTreeAdapter.detachNode(child);defaultTreeAdapter.appendChild(block,child);}
 }for(const element of elements)setLegacy(element);return serialize(tree);}
export function translationBatches(source:TranslationSource,done:Record<string,string>={}):TranslationUnit[][] {const batches:TranslationUnit[][]=[];let batch:TranslationUnit[]=[],size=0;for(const u of source.units){if(validUnitTranslation(u,done[u.id]))continue;if(batch.length>=TRANSLATION_LIMITS.units||size+u.text.length>TRANSLATION_LIMITS.inputChars){batches.push(batch);batch=[];size=0;}batch.push(u);size+=u.text.length;}if(batch.length)batches.push(batch);return batches;}
export function validateTranslationBatch(units:TranslationUnit[],value:unknown,mode:'current'|'legacy'='current'):Record<string,string>{if(!Array.isArray(value)||value.length!==units.length)throw new Error('翻译批次块数量不匹配。');const expected=new Map(units.map(u=>[u.id,u])),result:Record<string,string>={};for(const row of value){if(!row||typeof row!=='object'||!expected.has(row.id)||Object.hasOwn(result,row.id)||!(mode==='current'?newResponseIssue(expected.get(row.id)!,row.text)===undefined:validUnitTranslation(expected.get(row.id)!,row.text)))throw new Error('翻译块或受保护占位无效。');result[row.id]=row.text;}const reason=batchQualityIssue(units,Object.values(result),mode);if(reason)throw new Error(reason==='english_batch'?'翻译批次仍全部为英文，未计完成。':reason==='output_size'?'翻译输出超限。':'翻译批次未生成中文叙述，未计完成。');return result;}
const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[-\w]{1,100}$/.test(v);const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function copyTranslationSelection(value:unknown):TranslationSelection|undefined {if(!value||typeof value!=='object')return;const v=value as TranslationSelection;if((v.version!==undefined&&v.version!==1&&v.version!==2)||!safeId(v.translationId)||!hash(v.sourceVersion)||!safeId(v.blockId)||typeof v.quote!=='string'||!v.quote||v.quote.length>12000||typeof v.prefix!=='string'||v.prefix.length>240||typeof v.suffix!=='string'||v.suffix.length>240||!Number.isSafeInteger(v.start)||!Number.isSafeInteger(v.end)||v.start<0||v.end<=v.start||v.end-v.start!==v.quote.length)return;return{...(v.version!==undefined?{version:v.version}:{}),translationId:v.translationId,sourceVersion:v.sourceVersion,blockId:v.blockId,quote:v.quote,prefix:v.prefix,suffix:v.suffix,start:v.start,end:v.end};}
/** Translation routing is independent of inquiry preferences; never substitutes another model. */
export function translationModelConfig():ModelConfig {return {model:'gpt-6-luna',reasoningEffort:'medium'};}
export function isTranslationModelConfig(value:ModelConfig):boolean {const fixed=translationModelConfig();return value.model===fixed.model&&value.reasoningEffort===fixed.reasoningEffort;}
export function translationModelsUsed(state:Pick<WebTranslationState,'units'|'modelConfig'|'modelConfigsUsed'>):ModelConfig[] {
 if(!Object.keys(state.units).length)return [];
 return (state.modelConfigsUsed??[state.modelConfig]).map(config=>({...config}));
}
export function unionTranslationModels(configs:ModelConfig[],added:ModelConfig):ModelConfig[] {return [...configs.filter(config=>config.model!==added.model||config.reasoningEffort!==added.reasoningEffort),{...added}];}
export function copyWebTranslation(value:unknown,documentId:string,sourceVersion:string,source?:TranslationSource):WebTranslationState|undefined {if(!value||typeof value!=='object')return;const v=value as WebTranslationState,config=copyModelConfig(v.modelConfig);if(v.version!==2||!safeId(v.id)||v.target!=='zh'||v.documentId!==documentId||v.sourceVersion!==sourceVersion||!hash(sourceVersion)||!['partial','complete','interrupted','failed'].includes(v.status)||!config||typeof v.updatedAt!=='string'||!v.units||typeof v.units!=='object'||Array.isArray(v.units))return;if(v.batchEpoch!==undefined&&(!Number.isSafeInteger(v.batchEpoch)||v.batchEpoch<0||v.batchEpoch>10000))return;const units:Record<string,string>={};const known=new Map(source?.units.map(u=>[u.id,u]));let size=0;for(const[id,text]of Object.entries(v.units)){if(!safeId(id)||typeof text!=='string'||text.length>TRANSLATION_LIMITS.outputChars||(source&&(!known.has(id)||!validUnitTranslation(known.get(id)!,text))))return;size+=text.length;if(size>2_000_000)return;units[id]=text;}let modelConfigsUsed:ModelConfig[]|undefined;if(v.modelConfigsUsed!==undefined){if(!Array.isArray(v.modelConfigsUsed)||v.modelConfigsUsed.length>16)return;modelConfigsUsed=[];for(const item of v.modelConfigsUsed){const c=copyModelConfig(item);if(!c||modelConfigsUsed.some(x=>x.model===c.model&&x.reasoningEffort===c.reasoningEffort))return;modelConfigsUsed.push(c);}if(!Object.keys(units).length&&modelConfigsUsed.length)return;if(Object.keys(units).length&&!modelConfigsUsed.some(c=>c.model===config.model&&c.reasoningEffort===config.reasoningEffort))return;}const complete=!!source&&source.units.every(u=>validUnitTranslation(u,units[u.id]));return{version:2,id:v.id,target:'zh',documentId,sourceVersion,status:v.status==='complete'&&!complete?'partial':v.status,modelConfig:config,...(modelConfigsUsed!==undefined?{modelConfigsUsed}:{}),...(v.batchEpoch!==undefined?{batchEpoch:v.batchEpoch}:{}),units,updatedAt:v.updatedAt,...(typeof v.error==='string'?{error:v.error.slice(0,500)}:{})};}
