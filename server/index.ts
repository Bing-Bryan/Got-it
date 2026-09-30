import { randomBytes } from "node:crypto";
import { CodexLoginService, codexLoginRouter } from "./codex-login";
import { openReadingPage } from "./open-browser";
import { ReadingLibrary } from "./reading-library";
import { libraryRouter, localOriginGuard } from "./library-api";
import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseInquiryRequest,
  ProviderError,
  ProviderService,
  toProviderErrorBody,
  type ProviderServiceOptions,
} from "./providers";

export interface AppOptions {
  providerService?: ProviderService;
  providerOptions?: ProviderServiceOptions;
  distPath?: string;
  library?: ReadingLibrary;
  loginService?: CodexLoginService;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const providerService = options.providerService ?? new ProviderService(options.providerOptions);
  const distPath = resolve(options.distPath ?? process.env.DIST_DIR ?? join(process.cwd(), "dist"));

  app.disable("x-powered-by");
  app.use(localOriginGuard);
  const library=options.library ?? new ReadingLibrary();
  const sessionToken=randomBytes(32).toString("hex");
  app.use("/api/library", libraryRouter(library,sessionToken));
  async function imageInput(req: Request, inquiry: import("../src/types").InquiryRequest) {
    if(!inquiry.image)return undefined;
    if(req.headers["x-got-it-session"]!==sessionToken)throw new ProviderError("阅读会话已过期，请重新打开材料后重试。",401,"image_session_expired");
    const {entryId,fileHash,cropId}=inquiry.image;
    try { const {meta,bytes}=await library.resources.read(entryId,cropId);if(meta.kind!=="crop"||meta.fileHash!==fileHash)throw new Error();await library.resources.page(entryId,fileHash,meta.page!);return bytes; }
    catch {throw new ProviderError("裁图资源缺失或无权读取，请重新框选。",400,"image_resource_invalid");}
  }
  app.use(express.json({ limit: "256kb" }));
  const loginService = options.loginService ?? new CodexLoginService({ binary: options.providerOptions?.codexCliPath });
  app.locals.loginService = loginService;
  app.use("/api/providers/codex/login", codexLoginRouter(loginService));

  app.get("/api/providers", async (_request, response, next) => {
    try {
      response.json(await providerService.getProviders());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/providers/codex/models", async (request, response, next) => {
    try {
      response.setHeader("Cache-Control", "no-store");
      response.json({ models: await providerService.getModels(request.query.refresh === "true") });
    } catch (error) { next(error); }
  });

  // Keep a clear error for older clients; never read or validate a supplied key.
  app.post("/api/providers/deepseek/connect", (_request, _response, next) => {
    next(new ProviderError("当前版本仅支持 Codex，DeepSeek 连接已停用。", 410, "provider_disabled"));
  });

  app.post("/api/inquiries/stream", async (request, response, next) => {
    let inquiry, image;
    try { inquiry = parseInquiryRequest(request.body); image=await imageInput(request,inquiry); } catch (error) { next(error); return; }
    const requestId = inquiry.requestId || crypto.randomUUID();
    let sequence = 0;
    const controller = new AbortController();
    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.flushHeaders();
    response.on("close", () => { if (!response.writableEnded) controller.abort(); });
    const send = (event: object) => { if (!controller.signal.aborted) response.write(JSON.stringify({ ...event, requestId, sequence: ++sequence }) + "\n"); };
    try { await providerService.answer(inquiry, { signal: controller.signal, onEvent: send, image }); }
    catch (error) { send({ type: "error", error: toProviderErrorBody(error).body.error }); }
    finally { response.end(); }
  });

  app.post("/api/inquiries", async (request, response, next) => {
    try {
      const inquiry = parseInquiryRequest(request.body);
      response.json(await providerService.answer(inquiry,{image:await imageInput(request,inquiry)}));
    } catch (error) {
      next(error);
    }
  });

  if (existsSync(join(distPath, "index.html"))) {
    app.use(express.static(distPath));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(join(distPath, "index.html"));
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: "未找到请求的资源", code: "not_found" });
  });

  app.use(errorHandler);
  return app;
}

export function startServer(port = positivePort(process.env.PORT), open = false) {
  const app = createApp();
  const server = app.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    const url = `http://127.0.0.1:${address.port}/`;
    console.log(`Got-it API listening on ${url}`);
    void openReadingPage(url, {
      enabled: open,
      browser: process.env.BROWSER,
      hasBuild: existsSync(join(resolve(process.env.DIST_DIR ?? "dist"), "index.html")),
    });
  });
  server.once("close", () => app.locals.loginService.dispose());
  return server;
}

function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  const result = toProviderErrorBody(error);
  response.status(result.statusCode).json(result.body);
}

function positivePort(value: string | undefined): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : 8_787;
}

const currentFile = resolve(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentFile === invokedFile) {
  startServer(undefined, process.argv.includes("--open"));
}
