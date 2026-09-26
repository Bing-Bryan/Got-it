import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexLogin } from "./CodexLogin";
import type { CodexLoginState } from "./lib/codex-login";
let host: HTMLDivElement, root: Root;
let state: CodexLoginState;
let calls: string[];
const connected = vi.fn(async () => {});
const popup = { location: { href: "about:blank" }, opener: {}, closed: false, close: vi.fn() };
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state = { phase: "idle" }; calls = []; connected.mockClear(); popup.location.href = "about:blank"; popup.close.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(window, "open").mockReturnValue(popup as any);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith("/start")) state = { phase: "waiting", attemptId: "a", authUrl: "https://auth.openai.com/oauth/authorize?state=test", message: "等待官方登录" };
    if (url.endsWith("/cancel")) state = { phase: "cancelled", attemptId: "a", message: "已取消本次登录" };
    return { ok: true, json: async () => state };
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(availability: "available" | "connected" = "available") { await act(async () => root.render(<CodexLogin provider={{ id: "codex", name: "Codex", description: "", availability, supportsWebSearch: true }} onConnected={connected} />)); }
async function click(text: string) { await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === text)!.click()); }
it("opens official login and refreshes exactly once only after confirmed success", async () => {
  await mount(); await click("登录 Codex");
  expect(popup.location.href).toContain("https://auth.openai.com/"); expect(connected).not.toHaveBeenCalled();
  state = { phase: "succeeded", attemptId: "a", message: "登录成功" };
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(connected).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(2000)); expect(connected).toHaveBeenCalledTimes(1);
});
it("offers manual link when popup is blocked and cancels without logout", async () => {
  vi.mocked(window.open).mockReturnValue(null);
  await mount(); await click("登录 Codex"); expect(host.querySelector("a")?.href).toContain("auth.openai.com");
  await click("取消本次登录"); expect(host.textContent).toContain("已取消"); expect(host.querySelector('a[href*="auth.openai"]')).toBeNull();
  expect(connected).not.toHaveBeenCalled(); expect(calls.some(c => c.includes("logout"))).toBe(false);
});
it("recovers an ongoing attempt on reload and reports disconnect without declaring cancellation", async () => {
  state = { phase: "waiting", attemptId: "existing", authUrl: "https://auth.openai.com/oauth/authorize" };
  await mount(); expect(host.textContent).toContain("取消本次登录"); expect(window.open).not.toHaveBeenCalled();
  vi.mocked(fetch).mockRejectedValue(new Error("network offline"));
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).toContain("重新检查"); expect(host.textContent).not.toContain("已取消");
  expect(connected).not.toHaveBeenCalled();
});
it("shows failed attempt and allows retry while keeping already-connected UI quiet", async () => {
  await mount("connected"); expect(host.textContent).toBe("");
  await mount(); await click("登录 Codex");
  state = { phase: "failed", attemptId: "a", message: "登录等待超时" };
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(host.textContent).toContain("登录等待超时"); expect(host.textContent).toContain("登录 Codex"); expect(connected).not.toHaveBeenCalled();
});
