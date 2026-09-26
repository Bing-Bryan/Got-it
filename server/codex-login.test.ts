// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import express from "express";
import { once } from "node:events";
import { CodexLoginService, codexLoginRouter } from "./codex-login";
import { localOriginGuard } from "./library-api";
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawn: spawnMock }));
const services: CodexLoginService[] = [];
afterEach(() => { services.forEach(s => s.dispose()); services.length = 0; vi.useRealTimers(); vi.clearAllMocks(); });
const url = "https://auth.openai.com/oauth/authorize?state=public-state&code_challenge=public-challenge";
function fixture(mode = "normal") {
  const seen: any[] = [];
  const child: any = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = vi.fn(() => { queueMicrotask(() => child.emit("close", 0)); return true; });
  const send = (message: object) => child.stdout.write(JSON.stringify(message) + "\n");
  child.stdin.on("data", (chunk: Buffer) => {
    const m = JSON.parse(chunk.toString()); seen.push(m);
    if (mode === "silent") return;
    if (m.method === "initialize") send({ id: m.id, result: {} });
    if (m.method === "account/login/start") send(mode === "rpc-error" ? { id: m.id, error: { message: "secret-error-token" } } : { id: m.id, result: { type: "chatgpt", loginId: "official-id", authUrl: mode === "evil" ? "https://evil.test/login" : url, access_token: "secret-field" } });
    if (m.method === "account/read") send({ id: m.id, result: { account: mode === "unconfirmed" ? null : { type: "chatgpt", email: "private@example.test", token: "secret-field" } } });
  });
  spawnMock.mockReturnValue(child);
  const service = new CodexLoginService({ binary: "fake", startupMs: 25, timeoutMs: 50 }); services.push(service);
  return { service, child, send, seen };
}
it("waits for matching completion, verifies account, projects state and never requests tokens or turns", () => {
  const f = fixture(); const start = f.service.start();
  expect(start.phase).toBe("waiting");
  expect(f.service.start()).toEqual(start); expect(spawnMock).toHaveBeenCalledTimes(1);
  f.send({ method: "account/login/completed", params: { loginId: "other", success: true } });
  expect(f.service.status().phase).toBe("waiting");
  f.send({ method: "account/login/completed", params: { loginId: "official-id", success: true } });
  expect(f.service.status().phase).toBe("succeeded");
  expect(JSON.stringify(f.service.status())).not.toMatch(/secret|private|authUrl/);
  expect(f.seen.map(m => m.method)).toEqual(["initialize", "initialized", "account/login/start", "account/read"]);
  expect(f.seen.at(-1).params).toEqual({ refreshToken: false }); expect(f.child.kill).toHaveBeenCalled();
});
it("cancels without logout and ignores old completion/cancel after a new attempt", () => {
  const f = fixture(); const first = f.service.start();
  expect(f.service.cancel("stale").phase).toBe("waiting");
  expect(f.service.cancel(first.attemptId).phase).toBe("cancelled");
  expect(f.seen.at(-1).method).toBe("account/login/cancel");
  const other = fixture(); // install a new fake child for the same service
  const second = f.service.start();
  f.send({ method: "account/login/completed", params: { loginId: "official-id", success: true } });
  expect(f.service.cancel(first.attemptId)).toEqual(second);
  expect(f.service.status().phase).toBe("waiting"); expect(second.attemptId).not.toBe(first.attemptId);
  expect(other.seen.some(m => m.method === "account/logout")).toBe(false);
});
it.each(["rpc-error", "evil", "unconfirmed"])("fails closed for %s without forwarding raw errors", mode => {
  const f = fixture(mode); f.service.start();
  if (mode === "unconfirmed") f.send({ method: "account/login/completed", params: { loginId: "official-id", success: true } });
  expect(f.service.status().phase).toBe("failed"); expect(JSON.stringify(f.service.status())).not.toMatch(/secret|evil\.test/);
  expect(f.child.kill).toHaveBeenCalled();
});
it("handles timeout, malformed output, failed login and process exit", async () => {
  vi.useFakeTimers();
  for (const mode of ["silent", "waiting", "malformed", "closed", "denied", "missing", "large"]) {
    const f = fixture(mode); f.service.start();
    if (mode === "silent" || mode === "waiting") await vi.advanceTimersByTimeAsync(60);
    if (mode === "malformed") f.child.stdout.write("broken-json\n");
    if (mode === "closed") f.child.emit("close", 1);
    if (mode === "missing") f.child.emit("error", new Error("secret-path"));
    if (mode === "large") f.child.stderr.write("x".repeat(1024 * 1024 + 1));
    if (mode === "denied") f.send({ method: "account/login/completed", params: { loginId: "official-id", success: false, error: "secret-reason" } });
    expect(f.service.status().phase, mode).toBe("failed");
    expect(JSON.stringify(f.service.status())).not.toContain("secret");
  }
});
it("protects login mutations with local origin, JSON and attempt identity; responses are not cached", async () => {
  const f = fixture();
  const app = express(); app.use(localOriginGuard, express.json()); app.use("/login", codexLoginRouter(f.service));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}/login`;
  try {
    const bad = await fetch(base + "/start", { method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/json" }, body: "{}" }); expect(bad.status).toBe(403);
    expect((await fetch(base + "/start", { method: "POST" })).status).toBe(415); expect(spawnMock).not.toHaveBeenCalled();
    const response = await fetch(base + "/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(response.headers.get("cache-control")).toBe("no-store"); const state = await response.json(); expect(state.phase).toBe("waiting");
    const cancelled = await fetch(base + "/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: state.attemptId }) });
    expect((await cancelled.json()).phase).toBe("cancelled");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
