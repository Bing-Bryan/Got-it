import { lookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Source } from "../src/types";
import { safeSourceUrl } from "../src/lib/evidence";

export const READ_LIMITS = { sources: 3, pageMs: 8000, totalMs: 20000, bytes: 2 * 1024 * 1024, redirects: 3 };
type Address = { address: string; family: number };
export type Resolver = (host: string) => Promise<Address[]>;
export type PageBody = { url: string; text: string };
export type SourceReader = (url: string, signal: AbortSignal) => Promise<PageBody>;
export class ReadError extends Error {
  constructor(public readonly kind: "unavailable" | "unsupported", message: string) { super(message); }
}
export function publicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    // No mapped IPv4, translation, transition, multicast or special-purpose ranges.
    return parsed.range() === "unicast";
  } catch { return false; }
}
export async function resolvePublic(url: URL, resolver: Resolver): Promise<Address> {
  if (!safeSourceUrl(url.href)) throw new ReadError("unsupported", "不支持的链接");
  if (url.port && !["80", "443"].includes(url.port)) throw new ReadError("unsupported", "不支持的端口");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolver(host);
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) throw new ReadError("unavailable", "非公共地址");
  return addresses[0];
}

// Resolving and connecting are separate, but the connection is pinned to the vetted IP.
// Original Host and TLS servername are retained; no proxy env, credentials or cookies.
export function pinnedOptions(url: URL, address: Address, signal: AbortSignal): RequestOptions {
  return {
    protocol: url.protocol, hostname: address.address, family: address.family,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: `${url.pathname}${url.search}`, servername: isIP(url.hostname) ? undefined : url.hostname,
    headers: { Host: url.host, Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "identity", "User-Agent": "Got-it/0.1 source-verification" },
    agent: false, signal, maxHeaderSize: 16384,
  } as RequestOptions;
}

export function htmlText(html: string): string {
  const root = parse(html);
  const skip = new Set(["script", "style", "noscript", "template", "svg", "head"]);
  const blocks = new Set(["p", "div", "section", "article", "li", "br", "tr", "h1", "h2", "h3", "h4", "header", "footer"]);
  function walk(node: DefaultTreeAdapterMap["node"]): string {
    if (node.nodeName === "#text") return (node as DefaultTreeAdapterMap["textNode"]).value;
    if ("tagName" in node && (skip.has(node.tagName) || node.attrs.some((attr) => attr.name === "hidden" || (attr.name === "aria-hidden" && attr.value === "true")))) return "";
    const body = "childNodes" in node ? node.childNodes.map(walk).join("") : "";
    return "tagName" in node && blocks.has(node.tagName) ? ` ${body} ` : body;
  }
  return normalizeText(walk(root));
}
export function normalizeText(value: string): string { return value.replace(/\s+/gu, " ").trim(); }

export const readPublicPage: SourceReader = async (input, signal) => {
  let url = new URL(input);
  for (let redirects = 0; redirects <= READ_LIMITS.redirects; redirects++) {
    signal.throwIfAborted();
    // Race DNS against the deadline as DNS promises themselves cannot be cancelled.
    const address = await abortable(resolvePublic(url, (host) => lookup(host, { all: true })), signal);
    const result = await new Promise<{ location?: string; html?: string }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(pinnedOptions(url, address, signal), (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy(); resolve({ location: response.headers.location }); return;
        }
        if (status !== 200 || !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers["content-type"] ?? "") || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
          response.destroy(); reject(new ReadError(status === 200 ? "unsupported" : "unavailable", "正文不可读取")); return;
        }
        let length = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > READ_LIMITS.bytes) { response.destroy(new ReadError("unavailable", "正文超过大小限制")); return; }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(response.headers["content-type"] ?? "")?.[1] ?? "utf-8";
          try { resolve({ html: new TextDecoder(charset).decode(Buffer.concat(chunks)) }); }
          catch { reject(new ReadError("unsupported", "正文编码不支持")); }
        });
      });
      request.on("error", reject);
      request.end();
    });
    if (result.location) { url = new URL(result.location, url); continue; }
    return { url: url.href, text: htmlText(result.html ?? "") };
  }
  throw new ReadError("unavailable", "重定向超过限制");
};

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ReadError("unavailable", "读取超时"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function matchQuote(source: Source, page: PageBody): Source {
  const excerpt = normalizeText(source.excerpt ?? source.snippet ?? "");
  const text = normalizeText(page.text);
  const start = excerpt.length >= 12 ? text.indexOf(excerpt) : -1;
  const matched = start >= 0;
  return {
    ...source, url: page.url, domain: new URL(page.url).hostname,
    excerpt, excerptKind: matched ? "quote" : "unverified",
    retrievalStatus: matched ? "matched" : "mismatch", checkedAt: new Date().toISOString(),
    locatable: matched && text.indexOf(excerpt, start + 1) < 0 && !/\.pdf$/i.test(new URL(page.url).pathname),
  };
}

export async function verifySources(sources: Source[], reader: SourceReader = readPublicPage, options: { scope?: "initial" | "expanded"; signal?: AbortSignal; onStart?: () => void; onSource?: (source: Source) => void } = {}): Promise<Source[]> {
  const deadline = Date.now() + (options.scope === "expanded" ? 30000 : READ_LIMITS.totalMs);
  const limit = options.scope === "expanded" ? 5 : READ_LIMITS.sources;
  const output: Source[] = [];
  for (const [index, source] of sources.entries()) {
    options.signal?.throwIfAborted();
    const initial: Source = { ...source, excerpt: source.excerpt ?? source.snippet, excerptKind: "unverified", retrievalStatus: "not-read", locatable: false };
    if (index >= limit || Date.now() >= deadline || !initial.excerpt) { output.push(initial); continue; }
    if (/\.pdf$/i.test(new URL(source.url).pathname)) { output.push({ ...initial, retrievalStatus: "unsupported" }); continue; }
    const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.min(READ_LIMITS.pageMs, deadline - Date.now())));
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    options.onStart?.();
    try {
      const page = await abortable(reader(source.url, signal), signal);
      output.push(matchQuote(initial, page));
    } catch (error) {
      output.push({ ...initial, retrievalStatus: error instanceof ReadError ? error.kind : "unavailable" });
    }
    options.signal?.throwIfAborted();
    options.onSource?.(output[output.length - 1]);
  }
  return output;
}
