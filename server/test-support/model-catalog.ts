import type { CodexModel } from '../../src/lib/model-routing';
// Only injected tests use this catalog; production always queries model/list.
export const TEST_MODELS: CodexModel[] = ['gpt-5.6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-6-astra','gpt-5.5','gpt-6-luna','gpt-6-sol','gpt-6.1-sol'].map(model=>({model,displayName:model,description:'Test catalog',defaultReasoningEffort:'medium',supportedReasoningEfforts:(model==='gpt-5.5'?['low','medium','high','xhigh']:['low','medium','high','xhigh','max','ultra']).map(reasoningEffort=>({reasoningEffort,description:''})),isDefault:model==='gpt-6-astra'}));
export const testModelCatalog=async()=>TEST_MODELS;
