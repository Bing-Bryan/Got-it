import { expect, it, vi } from "vitest";
import { loadModelCatalog } from "./model-catalog";
import { TEST_MODELS } from "../../server/test-support/model-catalog";

it("recovers from an empty response once and preserves force-refresh", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 500 }))
    .mockResolvedValueOnce(Response.json({ models: TEST_MODELS }));
  expect(await loadModelCatalog(true, fetcher)).toEqual(TEST_MODELS);
  expect(fetcher.mock.calls).toEqual([["/api/providers/codex/models?refresh=true"], ["/api/providers/codex/models?refresh=true"]]);
});
it("bounds retries and translates malformed responses", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response("{"));
  await expect(loadModelCatalog(false, fetcher)).rejects.toThrow("本地模型服务返回不完整");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("translates network failures and preserves actionable server errors", async () => {
  const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(loadModelCatalog(false, offline)).rejects.toThrow("暂时无法连接本地模型服务");
  expect(offline).toHaveBeenCalledTimes(2);
  const denied = vi.fn().mockResolvedValue(Response.json({error:"请先登录本机Codex"}, {status:401}));
  await expect(loadModelCatalog(false, denied)).rejects.toThrow("请先登录本机Codex");
  expect(denied).toHaveBeenCalledTimes(1);
});
