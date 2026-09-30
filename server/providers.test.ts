import { testModelCatalog } from "./test-support/model-catalog";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { ExecFileOptions } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  parseInquiryRequest,
  ProviderError,
  ProviderService,
  type ProviderServiceOptions,
} from "./providers";

function inquiry(providerId: "codex" | "deepseek" | "demo", intent: "explain" | "verify" = "explain") {
  return parseInquiryRequest({
    providerId,
    intent,
    quote: "CAGR 是一个需要解释的术语。",
    context: "报告使用 CAGR 描述长期增长。",
    documentTitle: "示例报告",
    question: "这句话具体是什么意思？",
    history: [],
  });
}

describe("ProviderService", () => {
  it("rejects obsolete demo requests instead of returning placeholder answers", async () => {
    const service = new ProviderService({ modelCatalog: testModelCatalog });
    await expect(service.answer(inquiry("demo"))).rejects.toMatchObject({ code: "demo_disabled" });
  });

  it("never advertises or falls back to demo when real providers are unavailable", async () => {
    const service = new ProviderService({modelCatalog: testModelCatalog, execFileImpl: async () => { throw Object.assign(new Error("not installed"), { code: "ENOENT" }); } });
    const status = await service.getProviders();
    expect(status.providers.map(provider => provider.id)).toEqual(["codex"]);
    expect(status.defaultProviderId).toBe("codex");
    expect(status.providers[0].availability).toBe("unavailable");
  });

  it("ignores legacy environment keys and rejects DeepSeek without network requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network"));
    vi.stubEnv("DEEPSEEK_API_KEY", "test-only-key");
    try {
      const service = new ProviderService({ modelCatalog: testModelCatalog, execFileImpl: async () => ({ stdout: "Logged in using ChatGPT", stderr: "" }) });
      expect((await service.getProviders()).providers.map(p => p.id)).toEqual(["codex"]);
      await expect(service.answer(inquiry("deepseek"))).rejects.toMatchObject({ code: "provider_disabled" });
      await expect(service.answer(inquiry("deepseek", "verify"))).rejects.toMatchObject({ code: "provider_disabled" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); vi.unstubAllEnvs(); }
  });

  it("runs Codex in a temporary read-only directory with a schema and final output file", async () => {
    const tempDirs: string[] = [];
    const calls: Array<{ args: readonly string[]; options: ExecFileOptions }> = [];
    const options: ProviderServiceOptions = {
      codexCliPath: "/usr/local/bin/codex",
      execFileImpl: async (_file, args, execOptions) => {
        calls.push({ args, options: execOptions });
        if (args[0] === "login") {
          return { stdout: "Logged in using ChatGPT", stderr: "" };
        }
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        await writeFile(
          outputPath,
          JSON.stringify({
            answer: "这是 Codex 的局部回答。",
            evidenceStatus: "not-applicable",
            sources: [],
          }),
          "utf8",
        );
        return { stdout: "", stderr: "" };
      },
      makeTempDir: async (prefix) => {
        const directory = await mkdtemp(join(tmpdir(), prefix));
        tempDirs.push(directory);
        return directory;
      },
      removeTempDir: async (path) => {
        await rm(path, { recursive: true, force: true });
      },
    };
    const service = new ProviderService({...options, modelCatalog: testModelCatalog});

    const response = await service.answer(inquiry("codex"));

    const execCall = calls.find((call) => call.args.includes("exec"));
    expect(execCall).toBeDefined();
    expect(execCall?.args.slice(0, 2)).toEqual(["-c", 'model_reasoning_effort="low"']);
    expect(execCall?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "--ignore-rules",
        "--output-schema",
        "--output-last-message",
      ]),
    );
    expect(execCall?.options.cwd).toBeDefined();
    expect(execCall?.args[execCall?.args.indexOf("--cd") + 1]).toBe(execCall?.options.cwd);
    expect(execCall?.args.at(-1)).toContain("本次不是联网核查");
    expect(response.providerId).toBe("codex");
    expect(response.answer).toBe("这是 Codex 的局部回答。");
    expect(tempDirs.every((directory) => directory.length > 0)).toBe(true);

    // The provider reads only the final file, then removes the temporary directory.
    for (const directory of tempDirs) {
      await expect(readFile(directory, "utf8")).rejects.toThrow();
    }
  });

  it("enables Codex live search only for verification inquiries", async () => {
    const calls: Array<readonly string[]> = [];
    const service = new ProviderService({modelCatalog: testModelCatalog,
      execFileImpl: async (_file, args) => {
        calls.push(args);
        if (args[0] === "login") {
          return { stdout: "Logged in using ChatGPT", stderr: "" };
        }
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        await writeFile(
          outputPath,
          JSON.stringify({ answer: "需要核查。", evidenceStatus: "partial", sources: [] }),
          "utf8",
        );
        return { stdout: "", stderr: "" };
      },
    });

    await service.answer(inquiry("codex", "verify"));

    const execArgs = calls.find((args) => args.includes("exec"));
    expect(execArgs?.slice(0, 6)).toEqual(["-c", 'model_reasoning_effort="medium"', "-c", 'web_search="live"', "--search", "exec"]);
    expect(execArgs?.at(-1)).toContain("允许使用 Codex 提供的联网搜索");
  });

  it("verifies actual source quotes and refuses supported when search or text is missing", async () => {
    let searchOutput = [{ type: "turn.started" }, { type: "item.completed", item: { id: "s", type: "web_search", action: { type: "search", query: "CERN" } } }, { type: "turn.completed" }].map((event) => JSON.stringify(event)).join("\n");
    let body = "CERN made the Web public in 1993.";
    const service = new ProviderService({modelCatalog: testModelCatalog,
      sourceReader: async (url) => ({ url, text: body }),
      execFileImpl: async (_file, args) => {
        if (args[0] === "login") return { stdout: "Logged in using ChatGPT", stderr: "" };
        await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ answer: "找到来源。", evidenceStatus: "supported", sources: [{ id: "s", title: "CERN", url: "https://home.cern/web", domain: "fake.example", snippet: "CERN made the Web public in 1993.", relation: "supports" }] }));
        return { stdout: searchOutput, stderr: "" };
      },
    });
    const verified = await service.answer(inquiry("codex", "verify"));
    expect(verified).toMatchObject({ evidenceStatus: "partial", search: { status: "executed" } });
    expect(verified.sources[0]).toMatchObject({ domain: "home.cern", excerptKind: "quote", locatable: true });
    searchOutput = "";
    expect((await service.answer(inquiry("codex", "verify"))).evidenceStatus).toBe("partial");
    body = "Different text";
    expect((await service.answer(inquiry("codex", "verify"))).sources[0].excerptKind).toBe("unverified");
  });

  it("uses the user model selection instead of legacy global effort", async () => {
    const calls: Array<readonly string[]> = [];
    const service = new ProviderService({modelCatalog: testModelCatalog,
      codexReasoningEffort: "medium",
      execFileImpl: async (_file, args) => {
        calls.push(args);
        if (args[0] === "login") {
          return { stdout: "Logged in using ChatGPT", stderr: "" };
        }
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        await writeFile(
          outputPath,
          JSON.stringify({ answer: "ok", evidenceStatus: "not-applicable", sources: [] }),
          "utf8",
        );
        return { stdout: "", stderr: "" };
      },
    });

    await service.answer({ ...inquiry("codex"), modelConfig: { model: "gpt-5.6-sol", reasoningEffort: "medium" } });

    const execArgs = calls.find((args) => args.includes("exec"));
    expect(execArgs?.slice(0, 2)).toEqual(["-c", 'model_reasoning_effort="medium"']);
  });

  it("rejects malformed inquiry requests before reaching a provider", () => {
    expect(() => parseInquiryRequest({ providerId: "unknown" })).toThrowError(ProviderError);
    expect(() => parseInquiryRequest({ providerId: "demo", intent: "explain" })).toThrowError(
      /quote 不能为空/,
    );
  });
});
