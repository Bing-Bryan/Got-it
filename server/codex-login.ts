import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import express from "express";
import { resolveCodexBinary } from "./codex-runtime";
import { loginPending, safeLoginUrl, type CodexLoginState } from "../src/lib/codex-login";

type Attempt = { state: CodexLoginState; child?: ChildProcessWithoutNullStreams; loginId?: string; timer?: ReturnType<typeof setTimeout>; done: boolean };

/** Owns only a transient protocol session. Codex owns all credential storage. */
export class CodexLoginService {
  private attempt?: Attempt;
  constructor(private options: { binary?: string; startupMs?: number; timeoutMs?: number } = {}) {}
  status(): CodexLoginState { return { ...(this.attempt?.state ?? { phase: "idle" }) }; }
  start(): CodexLoginState {
    if (this.attempt && loginPending(this.attempt.state)) return this.status();
    const attempt: Attempt = { state: { phase: "starting", attemptId: randomUUID(), message: "正在启动 Codex 登录…" }, done: false };
    this.attempt = attempt;
    const fail = (message = "Codex 登录未完成，请重试；若持续失败，请更新 Codex。") => this.finish(attempt, "failed", message);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.options.binary ?? resolveCodexBinary(process.env.CODEX_CLI_PATH), ["app-server", "--listen", "stdio://"], { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch { fail("无法启动 Codex，请先安装或检查本机 Codex 配置。"); return this.status(); }
    attempt.child = child;
    attempt.timer = setTimeout(() => fail("启动 Codex 登录超时，请重试或更新 Codex。"), this.options.startupMs ?? 15_000);
    attempt.timer.unref();
    let buffer = "", bytes = 0, stage = 0;
    const send = (value: object) => { if (!attempt.done) child.stdin.write(JSON.stringify(value) + "\n"); };
    child.stdin.on("error", () => fail("Codex 登录连接已中断，请重试。"));
    child.on("error", () => fail("无法启动 Codex，请先安装或检查本机 Codex 配置。"));
    child.on("close", () => { if (!attempt.done) fail("Codex 登录进程已退出，请重试。"); });
    const count = (n: number) => { bytes += n; if (bytes > 1024 * 1024) fail("Codex 登录响应异常，请更新 Codex 后重试。"); };
    // Never log or forward protocol output or raw errors.
    child.stderr.on("data", (data: Buffer) => count(data.length));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      if (attempt.done) return;
      count(Buffer.byteLength(data)); buffer += data;
      let end: number;
      while (!attempt.done && (end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (!m || typeof m !== "object") throw Error();
          if (m.id === stage && !m.method) {
            if (m.error) { fail(); continue; }
            if (stage === 0) {
              stage = 1;
              send({ method: "initialized", params: {} });
              send({ id: 1, method: "account/login/start", params: { type: "chatgpt" } });
            } else if (stage === 1) {
              const url = safeLoginUrl(m.result?.authUrl);
              if (!url || m.result?.type !== "chatgpt" || typeof m.result.loginId !== "string" || !m.result.loginId) throw Error();
              attempt.loginId = m.result.loginId;
              attempt.state = { phase: "waiting", attemptId: attempt.state.attemptId, authUrl: url, message: "请在官方页面完成登录，完成后这里会自动更新。" };
              stage = -1;
              clearTimeout(attempt.timer);
              attempt.timer = setTimeout(() => { this.cancelProtocol(attempt); fail("登录等待超时，请重新登录。"); }, this.options.timeoutMs ?? 5 * 60_000);
              attempt.timer.unref();
            } else if (stage === 3) {
              if (m.result?.account?.type === "chatgpt") this.finish(attempt, "succeeded", "Codex 登录成功。");
              else fail("尚未确认 Codex 的 ChatGPT 登录，请重试。");
            }
          } else if (m.method === "account/login/completed" && attempt.loginId && m.params?.loginId === attempt.loginId && stage === -1) {
            if (m.params.success !== true) { fail(); continue; }
            stage = 3;
            clearTimeout(attempt.timer);
            attempt.timer = setTimeout(() => fail("确认 Codex 登录状态超时，请重新检查连接。"), this.options.startupMs ?? 15_000);
            attempt.timer.unref();
            send({ id: 3, method: "account/read", params: { refreshToken: false } });
          }
        } catch { fail("Codex 登录接口不兼容，请更新 Codex 后重试。"); }
      }
    });
    send({ id: 0, method: "initialize", params: { clientInfo: { name: "got_it", title: "Got-it", version: "0.1.0" } } });
    return this.status();
  }
  cancel(attemptId: unknown): CodexLoginState {
    const attempt = this.attempt;
    if (!attempt || attempt.state.attemptId !== attemptId) return this.status();
    if (!attempt.done) {
      this.cancelProtocol(attempt);
      this.finish(attempt, "cancelled", "已取消本次登录，可随时重试。");
    }
    return this.status();
  }
  dispose() { if (this.attempt) this.cancel(this.attempt.state.attemptId); }
  private cancelProtocol(attempt: Attempt) {
    if (!attempt.done && attempt.loginId) attempt.child?.stdin.write(JSON.stringify({ id: 2, method: "account/login/cancel", params: { loginId: attempt.loginId } }) + "\n");
  }
  private finish(attempt: Attempt, phase: CodexLoginState["phase"], message: string) {
    if (attempt.done) return;
    attempt.done = true;
    clearTimeout(attempt.timer);
    attempt.state = { phase, attemptId: attempt.state.attemptId, message };
    const child = attempt.child;
    if (!child) return;
    child.stdin.end(); child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 500); force.unref();
    child.once("close", () => clearTimeout(force));
  }
}

export function codexLoginRouter(service: CodexLoginService) {
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", (_req, res) => res.json(service.status()));
  router.post("/start", (req, res) => {
    if (!req.is("application/json")) { res.sendStatus(415); return; }
    res.json(service.start());
  });
  router.post("/cancel", (req, res) => {
    if (!req.is("application/json")) { res.sendStatus(415); return; }
    if (typeof req.body?.attemptId !== "string") { res.status(400).json({ error: "缺少登录会话，请刷新后重试。" }); return; }
    res.json(service.cancel(req.body.attemptId));
  });
  return router;
}
