import { expect, it, vi } from "vitest";
import { browserCommand, openReadingPage } from "./open-browser";

it("uses native commands without a shell and rejects non-local destinations", () => {
  const url = "http://127.0.0.1:8791/";
  expect(browserCommand(url, "darwin")).toEqual(["open", [url]]);
  expect(browserCommand(url, "win32")).toEqual(["rundll32.exe", ["url.dll,FileProtocolHandler", url]]);
  expect(browserCommand(url, "linux")).toEqual(["xdg-open", [url]]);
  expect(() => browserCommand("https://example.com/")).toThrow();
});
it("opens the supplied listening address once and offers fallback on failure", async () => {
  const open = vi.fn().mockRejectedValue(new Error("no browser")), warn = vi.fn();
  await expect(openReadingPage("http://127.0.0.1:8791/", { enabled: true, hasBuild: true, open, warn })).resolves.toBeUndefined();
  expect(open).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:8791/");
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("http://127.0.0.1:8791/"));
});
it("does not open for API-only, opt-out, or missing builds", async () => {
  const open = vi.fn(), warn = vi.fn();
  for (const options of [{ enabled: false, hasBuild: true }, { enabled: true, hasBuild: true, browser: "none" }, { enabled: true, hasBuild: false }]) {
    await openReadingPage("http://127.0.0.1:8791/", { ...options, open, warn });
  }
  expect(open).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("npm run build"));
});
