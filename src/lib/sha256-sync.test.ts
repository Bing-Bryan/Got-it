import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { sha256Hex } from "./sha256-sync";

it("matches node:crypto SHA-256 across block boundaries and non-ASCII text", () => {
  const samples = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "中文原文与 emoji 😀", "md1\n# Title\n\nBody."];
  for (const value of samples) expect(sha256Hex(value)).toBe(createHash("sha256").update(value, "utf8").digest("hex"));
});
