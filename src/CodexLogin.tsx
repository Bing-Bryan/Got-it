import { useCallback, useEffect, useRef, useState } from "react";
import { loginPending, safeLoginUrl, type CodexLoginState } from "./lib/codex-login";
import type { ProviderStatus } from "./types";

async function loginRequest(action = "", body?: object): Promise<CodexLoginState> {
  let response: Response;
  try { response = await fetch(`/api/providers/codex/login${action}`, {
    method: body ? "POST" : "GET", cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  }); } catch { throw new Error("无法连接登录服务，请确认本地服务正在运行后重试。"); }
  if (!response.ok) throw new Error("无法连接登录服务，请确认本地服务正在运行后重试。");
  let value: any;
  try { value = await response.json(); } catch { throw new Error("登录接口返回异常，请更新并重启本地服务。"); }
  if (!value || !["idle", "starting", "waiting", "succeeded", "failed", "cancelled"].includes(value.phase)) throw new Error("登录接口暂不可用，请更新并重启本地服务。");
  if (value.phase !== "idle" && typeof value.attemptId !== "string") throw new Error("登录会话无效，请重试。");
  const authUrl = safeLoginUrl(value.authUrl);
  if (value.phase === "waiting" && !authUrl) throw new Error("登录地址无效，请更新 Codex 后重试。");
  return { phase: value.phase, attemptId: value.attemptId, ...(authUrl ? { authUrl } : {}), message: typeof value.message === "string" ? value.message : undefined };
}

export function CodexLogin({ provider, onConnected }: { provider: ProviderStatus; onConnected: () => Promise<void> }) {
  const [state, setState] = useState<CodexLoginState>({ phase: "idle" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const popup = useRef<Window | null>(null);
  const opened = useRef("");
  const completed = useRef("");
  const generation = useRef(0);
  const mounted = useRef(true);
  const closeBlank = () => { try { if (popup.current && !popup.current.closed && !opened.current) popup.current.close(); } catch { /* cross-origin window remains user owned */ } popup.current = null; };
  const accept = useCallback((next: CodexLoginState) => {
    setState(next); setError("");
    if (next.authUrl && popup.current && opened.current !== next.attemptId) {
      try { popup.current.location.href = next.authUrl; opened.current = next.attemptId!; }
      catch { closeBlank(); }
    }
    if (!loginPending(next)) closeBlank();
  }, []);
  useEffect(() => {
    mounted.current = true;
    const version = generation.current;
    void loginRequest().then(next => { if (mounted.current && version === generation.current) accept(next); }).catch(() => { /* no login requested yet; primary connection status remains visible */ });
    return () => { mounted.current = false; generation.current++; closeBlank(); };
  }, [accept]);
  useEffect(() => {
    if (state.phase !== "succeeded" || completed.current === state.attemptId) return;
    completed.current = state.attemptId!;
    void onConnected();
  }, [state.phase, state.attemptId, onConnected]);
  useEffect(() => {
    if (!loginPending(state) || error || busy) return;
    let stopped = false;
    const version = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await loginRequest();
        if (stopped || version !== generation.current) return;
        if (next.attemptId !== state.attemptId) {
          closeBlank();
          setError("登录会话已改变或本地服务已重启，请重新检查登录状态。"); return;
        }
        accept(next);
        if (loginPending(next)) timer = setTimeout(poll, 1000);
      } catch (e) { if (!stopped && version === generation.current) { closeBlank(); setError((e as Error).message); } }
    };
    timer = setTimeout(poll, 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [state.attemptId, state.phase, error, busy, accept]);

  const act = async (action: "start" | "cancel" | "check") => {
    if (busy) return;
    const version = ++generation.current;
    setBusy(true); setError("");
    if (action === "start") {
      closeBlank(); opened.current = "";
      try { popup.current = window.open("about:blank", "_blank"); if (popup.current) popup.current.opener = null; } catch { popup.current = null; }
    }
    try {
      const next = await loginRequest(action === "check" ? "" : `/${action}`, action === "start" ? {} : action === "cancel" ? { attemptId: state.attemptId } : undefined);
      if (mounted.current && version === generation.current) accept(next);
    } catch (e) { if (mounted.current && version === generation.current) { closeBlank(); setError((e as Error).message); } }
    finally { if (mounted.current && version === generation.current) setBusy(false); }
  };
  const pending = loginPending(state);
  const connected = provider.availability === "connected";
  if (connected && !pending && !error) return null;
  return <section className="codex-login" aria-label="Codex 登录">
    {!connected && !pending ? <p>{provider.availability === "unavailable" ? "请先确认已安装并可运行本机 Codex，然后刷新连接。" : "使用你自己的 Codex 账号登录，无需填写 API Key。"}</p> : null}
    {state.message ? <p role="status">{state.message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="codex-login-actions">
      {!pending ? <button type="button" disabled={busy || provider.availability === "checking"} onClick={() => void act("start")}>{busy ? "正在连接…" : "登录 Codex"}</button> : <>
        {state.authUrl ? <a href={state.authUrl} target="_blank" rel="noreferrer noopener">打开官方登录页</a> : null}
        <button type="button" disabled={busy} onClick={() => void act("cancel")}>取消本次登录</button>
      </>}
      {error ? <button type="button" disabled={busy} onClick={() => void act("check")}>重新检查</button> : null}
      {!pending && provider.availability === "unavailable" ? <a href="https://developers.openai.com/codex/cli/" target="_blank" rel="noreferrer noopener">安装指引</a> : null}
    </div>
    {pending ? <small>若没有弹出浏览器，请点击登录页链接。登录完成后自动更新；也可取消后重试。</small> : null}
  </section>;
}
