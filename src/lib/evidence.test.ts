import { describe, expect, it } from "vitest";
import { sourceLocation, safeSourceUrl, copySearch, sourceEvidence } from "./evidence";
import type { Source } from "../types";
const source: Source = { id: "s", title: "test", url: "https://example.com/a#section", domain: "example.com", excerpt: "中文 - 50%, 'test'", excerptKind: "quote", retrievalStatus: "matched", locatable: true };
describe("source links and projection", () => {
  it("encodes exact text while preserving an existing anchor", () => {
    const url = sourceLocation(source)!;
    expect(url).toContain("#section:~:text=");
    expect(url).toContain("%2D");
    expect(decodeURIComponent(url.split(":~:text=")[1])).toBe(source.excerpt);
  });
  it("does not locate ambiguous, unverified or PDF citations and rejects executable URLs", () => {
    expect(sourceLocation({ ...source, excerptKind: "unverified" })).toBeUndefined();
    expect(sourceLocation({ ...source, locatable: false })).toBeUndefined();
    expect(sourceLocation({ ...source, url: "https://example.com/a.pdf" })).toBeUndefined();
    expect(safeSourceUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeSourceUrl("https://user:secret@example.com")).toBeUndefined();
  });
  it("drops runtime fields and malformed enums", () => {
    expect(sourceEvidence({ ...source, token: "secret", html: "raw page" } as Source)).not.toHaveProperty("token");
    expect(copySearch({ status: "executed", completedSearches: 1, failedSearches: 0, logs: "secret" })).toEqual({ status: "executed", completedSearches: 1, failedSearches: 0 });
    expect(copySearch({ status: "invented" })).toBeUndefined();
  });
});
