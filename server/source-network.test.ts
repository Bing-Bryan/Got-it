// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock("node:http", () => ({ request: mock.request }));
vi.mock("node:https", () => ({ request: mock.request }));
vi.mock("node:dns/promises", () => ({ lookup: mock.lookup }));
import { readPublicPage, READ_LIMITS } from "./source-reader";

afterEach(() => { vi.clearAllMocks(); });
function setup(responses: Array<{ status?: number; headers?: Record<string, string>; chunks?: Buffer[] }>) {
  mock.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mock.request.mockImplementation((_options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      queueMicrotask(() => {
        const spec = responses.shift()!;
        const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
        response.statusCode = spec.status ?? 200;
        response.headers = spec.headers ?? { "content-type": "text/html; charset=utf-8" };
        callback(response);
        if (!response.destroyed) {
          for (const chunk of spec.chunks ?? [Buffer.from("<p>public source body</p>")]) response.write(chunk);
          response.end();
        }
      });
    };
    return request;
  });
}
describe("bounded HTTP transport", () => {
  it("checks redirect destination before making any second connection", async () => {
    setup([{ status: 302, headers: { location: "http://127.0.0.1/private" } }]);
    await expect(readPublicPage("https://example.com", AbortSignal.timeout(1000))).rejects.toThrow("非公共地址");
    expect(mock.request).toHaveBeenCalledTimes(1);
  });
  it("limits redirects to three and checks every DNS result", async () => {
    setup(Array.from({ length: 4 }, () => ({ status: 302, headers: { location: "https://example.com/next" } })));
    await expect(readPublicPage("https://example.com", AbortSignal.timeout(1000))).rejects.toThrow("重定向超过限制");
    expect(mock.lookup).toHaveBeenCalledTimes(4);
    expect(mock.request).toHaveBeenCalledTimes(4);
  });
  it("rejects oversized, compressed, non-HTML and access-denied responses", async () => {
    setup([{ chunks: [Buffer.alloc(READ_LIMITS.bytes + 1)] }]);
    await expect(readPublicPage("https://example.com", AbortSignal.timeout(1000))).rejects.toThrow("大小限制");
    setup([{ headers: { "content-type": "application/pdf" } }]);
    await expect(readPublicPage("https://example.com", AbortSignal.timeout(1000))).rejects.toMatchObject({ kind: "unsupported" });
    setup([{ headers: { "content-type": "text/html", "content-encoding": "gzip" } }]);
    await expect(readPublicPage("https://example.com", AbortSignal.timeout(1000))).rejects.toThrow();
    setup([{ status: 403 }]);
    await expect(readPublicPage("https://example.com", AbortSignal.timeout(1000))).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("extracts HTML and retains final redirect URL without forwarding cookies", async () => {
    setup([{ status: 302, headers: { location: "https://other.example/report", "set-cookie": "secret" } }, {}]);
    expect(await readPublicPage("https://example.com", AbortSignal.timeout(1000))).toEqual({ url: "https://other.example/report", text: "public source body" });
    expect(mock.request.mock.calls[1][0]).toMatchObject({ hostname: "93.184.216.34", servername: "other.example", headers: { Host: "other.example" } });
    expect(mock.request.mock.calls[1][0].headers).not.toHaveProperty("Cookie");
  });
  it("bounds stalled DNS and does not initiate a late connection", async () => {
    setup([]);
    let release: (value: unknown) => void = () => {};
    mock.lookup.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await expect(readPublicPage("https://example.com", AbortSignal.timeout(20))).rejects.toThrow("超时");
    release([{ address: "93.184.216.34", family: 4 }]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.request).not.toHaveBeenCalled();
  });
});
