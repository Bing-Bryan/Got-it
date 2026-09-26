import type { CodexModel } from "./model-routing";

/** Retry one transient transport/parse failure without hiding server error messages. */
export async function loadModelCatalog(refresh = false, fetcher = fetch): Promise<CodexModel[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetcher(`/api/providers/codex/models${refresh ? "?refresh=true" : ""}`);
    } catch {
      if (!attempt) continue;
      throw new Error("暂时无法连接本地模型服务，请稍后点击“重试读取模型”");
    }
    let data;
    try { data = await response.json(); }
    catch {
      if (!attempt) continue;
      throw new Error("本地模型服务返回不完整，模型列表暂时无法读取，请点击“重试读取模型”");
    }
    if (!response.ok || !Array.isArray(data?.models) || !data.models.length) {
      if (response.status >= 500 && !attempt) continue;
      throw new Error(typeof data?.error === "string" ? data.error : "模型列表暂时不可用，请稍后点击“重试读取模型”");
    }
    return data.models;
  }
  throw new Error("模型列表暂时不可用");
}
