export type LoginPhase = "idle" | "starting" | "waiting" | "succeeded" | "failed" | "cancelled";
export interface CodexLoginState {
  phase: LoginPhase;
  attemptId?: string;
  authUrl?: string;
  message?: string;
}
export const loginPending = (state: CodexLoginState) => state.phase === "starting" || state.phase === "waiting";
export function safeLoginUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8192) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["auth.openai.com", "chatgpt.com"].includes(url.hostname) || url.port || url.username || url.password || url.hash) return;
    if (["access_token", "refresh_token", "id_token"].some(key => url.searchParams.has(key))) return;
    return url.href;
  } catch { return; }
}
