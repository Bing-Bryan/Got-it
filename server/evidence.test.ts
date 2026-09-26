// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { parseSearchTrace } from "./search-trace";
import { htmlText, matchQuote, pinnedOptions, publicAddress, READ_LIMITS, resolvePublic, verifySources } from "./source-reader";
import type { Source } from "../src/types";

const source: Source = { id: "s", title: "来源", url: "https://example.com/report", domain: "example.com", snippet: "这个行业的前五家公司占据了百分之七十的市场。", relation: "supports" };
const events = (...items: unknown[]) => [{ type: "turn.started" }, ...items, { type: "turn.completed" }].map((item) => JSON.stringify(item)).join("\n");
const search = (id: string, extra = {}) => ({ type: "item.completed", item: { type: "web_search", id, action: { type: "search", query: "public claim" }, ...extra } });

describe("observable search execution", () => {
  it("recognizes the real 0.153.4 fixture without counting page opens", async () => {
    const fixture = await readFile(new URL("./fixtures/codex-0.153.4-search.jsonl", import.meta.url), "utf8");
    expect(parseSearchTrace(fixture)).toEqual({ status: "executed", completedSearches: 1, failedSearches: 0 });
  });
  it("distinguishes success, failure, absent search, partial failure and uncertainty", () => {
    expect(parseSearchTrace(events(search("a"))).status).toBe("executed");
    expect(parseSearchTrace(events(search("a", { status: "failed" }))).status).toBe("failed");
    expect(parseSearchTrace(events({ type: "item.completed", item: { type: "agent_message", text: "I searched" } })).status).toBe("not-executed");
    expect(parseSearchTrace(events(search("a"), search("b", { error: "timeout" })))).toMatchObject({ status: "executed", failedSearches: 1 });
    for (const output of ["", '{"type":"turn.started"}', events({ type: "future.event" }), events(search("a")) + "\n{", events({ type: "item.started", item: { type: "web_search", id: "pending" } })]) {
      expect(parseSearchTrace(output).status).toBe("unknown");
    }
  });
});

describe("public source reading boundaries", () => {
  it("blocks private, mapped, transition, multicast and special IP ranges", () => {
    for (const ip of ["127.0.0.1", "0.0.0.0", "10.1.2.3", "192.168.1.1", "172.16.1.1", "169.254.169.254", "100.64.0.1", "192.0.2.1", "224.1.2.3", "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "64:ff9b::a00:1", "2002:7f00:1::"]) expect(publicAddress(ip), ip).toBe(false);
    expect(publicAddress("93.184.216.34")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("validates every address and pins the connection without another DNS lookup", async () => {
    const resolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const url = new URL("https://example.com/report");
    const ip = await resolvePublic(url, resolver);
    const options = pinnedOptions(url, ip, new AbortController().signal);
    expect(options).toMatchObject({ hostname: "93.184.216.34", servername: "example.com", agent: false, headers: { Host: "example.com" } });
    expect(options.lookup).toBeUndefined();
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.headers).not.toHaveProperty("Cookie");
    await expect(resolvePublic(url, async () => [ip, { address: "127.0.0.1", family: 4 }])).rejects.toThrow();
    for (const href of ["http://127.1/a", "http://[::1]/", "file:///etc/passwd", "https://user:secret@example.com/", "https://example.com:8787/"]) await expect(resolvePublic(new URL(href), resolver)).rejects.toThrow();
  });
  it("never executes scripts and matches only verbatim visible text", () => {
    const text = htmlText('<html><head><title>Ignore</title></head><body><script>bad()</script><div hidden>secret</div><p>这个行业的前五家公司<span>占据了</span>百分之七十的市场。</p></body></html>');
    expect(text).toBe(source.snippet);
    expect(matchQuote(source, { url: source.url, text })).toMatchObject({ excerptKind: "quote", locatable: true });
    expect(matchQuote(source, { url: source.url, text: `${text} ${text}` })).toMatchObject({ excerptKind: "quote", locatable: false });
    expect(matchQuote(source, { url: source.url, text: "Top five firms hold 70% of the market." }).excerptKind).toBe("unverified");
    expect(matchQuote(source, { url: source.url, text: "五家公司拥有七成市场。" }).retrievalStatus).toBe("mismatch");
    expect(matchQuote({ ...source, snippet: "hello   world example" }, { url: source.url, text: "hello\nworld example" }).excerptKind).toBe("quote");
  });
  it("limits candidates and handles PDF and reader failure without fake quotes", async () => {
    const reader = vi.fn(async (url: string) => ({ url, text: source.snippet! }));
    const result = await verifySources(Array.from({ length: 5 }, () => source), reader);
    expect(reader).toHaveBeenCalledTimes(3);
    expect(result[3].retrievalStatus).toBe("not-read");
    const pdf = await verifySources([{ ...source, url: "https://example.com/a.pdf" }], reader);
    expect(pdf[0].retrievalStatus).toBe("unsupported");
    const failed = await verifySources([source], async () => { throw new Error("network failed"); });
    expect(failed[0]).toMatchObject({ excerptKind: "unverified", retrievalStatus: "unavailable", locatable: false });
  });
  it("bounds a stalled reader by page and overall deadlines", async () => {
    vi.useFakeTimers();
    // AbortSignal.timeout uses runtime timers; inject a reader rejecting on elapsed page budget.
    const reader = vi.fn((_url: string, signal: AbortSignal) => new Promise<never>((_, reject) => {
      expect(signal).toBeDefined();
      setTimeout(() => reject(new Error("timeout")), Math.min(READ_LIMITS.pageMs, 20000 - Date.now()));
    }));
    vi.setSystemTime(0);
    const pending = verifySources([source, source, source, source], reader);
    await vi.advanceTimersByTimeAsync(20000);
    const result = await pending;
    expect(reader).toHaveBeenCalledTimes(3);
    expect(result[3].retrievalStatus).toBe("not-read");
    vi.useRealTimers();
  });
});
