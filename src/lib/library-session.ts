let token: Promise<string> | null = null;
export async function librarySession() {
  if (!token) token = fetch("/api/library/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(async r => { if (!r.ok) throw new Error("本机阅读服务无法连接。"); return (await r.json()).token as string; }).catch(e => { token = null; throw e; });
  return token;
}
export function invalidateLibrarySession(){token=null;}
