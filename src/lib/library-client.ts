let token: Promise<string> | null = null;
export class LibraryClientError extends Error { constructor(message: string, public status: number) { super(message); } }
async function session() {
  if (!token) token = fetch("/api/library/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(async r => { if (!r.ok) throw new Error("本机阅读服务无法连接。"); return (await r.json()).token as string; }).catch(e => { token = null; throw e; });
  return token;
}
export async function libraryRequest<T>(path = "", body?: unknown, retry = true): Promise<T> {
  const response = await fetch(`/api/library${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-Got-It-Session": await session() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.status === 401 && retry) { token = null; return libraryRequest(path, body, false); }
  const result = await response.json();
  if (!response.ok) throw new LibraryClientError(result.error || "阅读操作失败，请重试。", response.status);
  return result as T;
}
