import { TEST_MODELS } from "../../server/test-support/model-catalog";
import { describe, expect, it } from 'vitest';
import { anchorGroup, intentHistory, copyActiveTab } from './inquiry-tabs';
import { modelConfig, copyModelConfig, resolveModelConfig } from './model-routing';
import { sanitizeWorkspace, loadWorkspace, STORAGE_KEY } from './storage';
import { responseMessage } from './inquiry-stream';
import { createInitialWorkspace } from '../sample';
function fixture() {
 const w=createInitialWorkspace();
 w.inquiries=[{id:'a',intent:'explain',question:'解释',anchor:{documentId:w.document.id,blockId:'p1',headingPath:[],quote:'CAGR',prefix:'',suffix:'',start:0,end:4,matchStatus:'matched'},status:'ready',messages:[],understanding:'',createdAt:'2026',updatedAt:'2026'}];
 w.activeInquiryId='a'; return w;
}
import { workspaceToJson, workspaceToMarkdown } from './export';

describe('same passage intent navigation and safe preferences', () => {
 it('groups exact anchors without merging repeated words or unresolved anchors', () => {
  const base = fixture().inquiries[0];
  const entity = {...base,id:'entity',intent:'entity' as const};
  const repeat = {...base,id:'repeat',anchor:{...base.anchor,start:base.anchor.start+10}};
  const missing = {...base,id:'missing',anchor:{...base.anchor,matchStatus:'needs-relink' as const}};
  const all=[base,entity,repeat,missing];
  expect(anchorGroup(all,base).map(i=>i.id)).toEqual([base.id,'entity']);
  expect(anchorGroup(all,missing).map(i=>i.id)).toEqual(['missing']);
 });
 it('keeps duplicate history and chooses newest with stable ties', () => {
  const base=fixture().inquiries[0];
  const all=[base,{...base,id:'new',updatedAt:'2099'},{...base,id:'tie',updatedAt:'2099'}];
  expect(intentHistory(all,base.intent).map(i=>i.id)).toEqual(['new','tie',base.id]);
  expect(all.length).toBe(3);
 });
 it('uses requested defaults and keeps independent user choices', () => {
  expect(modelConfig('explain')).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'});
  expect(modelConfig('verify')).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'});
  expect(modelConfig('entity')).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'});
  expect(modelConfig('entity',{entity:{model:'gpt-5.6-terra',reasoningEffort:'low'}}).model).toBe('gpt-5.6-terra');
  expect(copyModelConfig({model:'--unsafe',reasoningEffort:'max'})).toBeUndefined();
 });
 it('round trips empty active tabs and safe preferences without inventing old model metadata', () => {
  const workspace=fixture();
  workspace.activeTab={anchorInquiryId:workspace.inquiries[0].id,intent:'entity'};
  workspace.modelPreferences={entity:{...modelConfig('entity'),secret:'credential'} as never};
  const raw=workspaceToJson(workspace);
  const loaded=loadWorkspace({getItem:key=>key===STORAGE_KEY?raw:null,setItem(){},removeItem(){}})!;
  expect(loaded.activeTab).toEqual(workspace.activeTab);
  expect(raw).not.toContain('credential');
  expect(loaded.inquiries[0].messages.at(-1)?.modelConfig).toBeUndefined();
  expect(copyActiveTab({anchorInquiryId:'missing',intent:'entity'},workspace.inquiries)).toBeUndefined();
  expect(sanitizeWorkspace({...workspace,modelPreferences:{entity:{model:'bad'} as never}}).modelPreferences).toEqual({});
 });
 it('retains request snapshot through response, interruption recovery and exports', () => {
  const workspace=fixture(), config=modelConfig('entity');
  const message=responseMessage('test',{providerId:'codex',intent:'entity',operation:'entity',quote:'x',context:'',documentTitle:'',question:'',history:[],modelConfig:config},{answer:'真实结果',mode:'live',providerId:'codex',providerName:'Codex',sources:[],model:config.model,modelConfig:config,evidenceStatus:'not-applicable'},false);
  workspace.inquiries[0].messages.push(message); workspace.inquiries[0].status='answering';
  const raw=workspaceToJson(workspace);
  const loaded=loadWorkspace({getItem:()=>raw,setItem(){},removeItem(){}})!;
  expect(loaded.inquiries[0].messages.at(-1)).toMatchObject({completion:'interrupted',modelConfig:config,operation:'entity'});
  expect(workspaceToMarkdown(loaded)).toContain('gpt-6.1-sol · medium');
 });
});

it('repairs unavailable future preferences, preserves valid choices and uses official defaults for incompatible efforts',()=>{
 const models=TEST_MODELS.filter(m=>m.model!=='gpt-6.1-sol');
 expect(resolveModelConfig('explain',undefined,models)).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'});
 const chosen={model:'gpt-5.5',reasoningEffort:'high'};
 expect(resolveModelConfig('explain',{explain:chosen},models)).toEqual(chosen);
 expect(resolveModelConfig('explain',{explain:{...chosen,reasoningEffort:'max'}},models)).toEqual({...chosen,reasoningEffort:'medium'});
 expect(resolveModelConfig('explain',undefined,models.filter(m=>m.model!=='gpt-5.6-sol'))).toEqual({model:'gpt-6.1-sol',reasoningEffort:'medium'});
 expect(resolveModelConfig('explain',undefined,[])).toEqual(modelConfig('explain'));
});
