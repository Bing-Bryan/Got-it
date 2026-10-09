import type { InquiryIntent } from "../types";

const TRANSPORT_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
export type ModelConfig = { model: string; reasoningEffort: string };
export interface CodexModel {
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  isDefault: boolean;
  /** Missing in older app-server versions; explicit lists must be respected. */
  inputModalities?: Array<'text' | 'image'>;
}
export function modelAcceptsImage(model: CodexModel): boolean {
  return model.inputModalities === undefined || model.inputModalities.includes('image');
}
export function supportsConfig(models: CodexModel[], config: ModelConfig): boolean {
  return models.some(m => m.model === config.model && m.supportedReasoningEfforts.some(e => e.reasoningEffort === config.reasoningEffort));
}
export type ModelPreferences = Partial<Record<InquiryIntent, ModelConfig>>;
export function copyModelConfig(value: unknown): ModelConfig | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as ModelConfig;
  if (typeof v.model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(v.model) && TRANSPORT_EFFORTS.includes(v.reasoningEffort)) return { model: v.model, reasoningEffort: v.reasoningEffort };
}
export function modelConfig(intent: InquiryIntent, preferences?: ModelPreferences): ModelConfig {
  return copyModelConfig(preferences?.[intent]) ?? { model: "gpt-6.1-sol", reasoningEffort: "medium" };
}
export function copyModelPreferences(value: unknown): ModelPreferences {
  const result: ModelPreferences = {};
  if (value && typeof value === "object") for (const intent of ["explain", "verify", "entity", "why", "ask"] as const) {
    const config = copyModelConfig((value as ModelPreferences)[intent]);
    if (config) result[intent] = config;
  }
  return result;
}

/** Repair future-request preferences only; historical response metadata is never changed. */
export function resolveModelConfig(intent: InquiryIntent, preferences: ModelPreferences | undefined, models: CodexModel[]): ModelConfig {
  const requested = modelConfig(intent, preferences);
  if (requested.model === "gpt-6.1-sol" || !models.length || supportsConfig(models, requested)) return requested;
  const sameModel = models.find(m => m.model === requested.model);
  if (sameModel) return { model: sameModel.model, reasoningEffort: sameModel.defaultReasoningEffort };
  // Prefer the user's established SOL route before the account's general default.
  const replacement = models.find(m => m.model === "gpt-5.6-sol") ?? models.find(m => m.isDefault) ?? models[0];
  return { model: replacement.model, reasoningEffort: replacement.model === "gpt-5.6-sol" && replacement.supportedReasoningEfforts.some(e => e.reasoningEffort === "medium") ? "medium" : replacement.defaultReasoningEffort };
}
