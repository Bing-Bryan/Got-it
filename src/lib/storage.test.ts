import { describe, expect, it } from "vitest";
import type { Anchor, Workspace } from "../types";
import {
  WORKSPACE_STORAGE_KEY,
  clearWorkspace,
  loadWorkspace,
  saveWorkspace,
} from "./storage";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const anchor: Anchor = {
  documentId: "doc-1",
  blockId: "block-1",
  headingPath: ["第一节"],
  quote: "CAGR",
  prefix: "了解 ",
  suffix: " 是什么",
  start: 3,
  end: 7,
  matchStatus: "matched",
};

function workspace(): Workspace {
  return {
    schemaVersion: 1,
    document: {
      id: "doc-1",
      filename: "report.md",
      markdown: "了解 CAGR 是什么",
      importedAt: "2026-09-21T00:00:00.000Z",
      contentHash: "hash",
      isDemo: false,
    },
    inquiries: [
      {
        id: "inquiry-1",
        intent: "explain",
        question: "CAGR 是什么？",
        anchor,
        status: "ready",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "它是复合年增长率。",
            createdAt: "2026-09-21T00:00:00.000Z",
            providerId: "demo",
            providerName: "Demo",
            sources: [
              { id: "source-1", title: "Example", url: "https://example.com", domain: "example.com" },
            ],
          },
        ],
        understanding: "我知道它描述一段时间内的年化增长。",
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      },
    ],
    activeInquiryId: "inquiry-1",
    activeProviderId: "demo",
    updatedAt: "2026-09-21T00:00:00.000Z",
    hasUnexportedChanges: true,
  };
}

describe("workspace storage", () => {
  it("round-trips a versioned workspace and strips provider keys", () => {
    const storage = new MemoryStorage();
    const dirty = {
      ...workspace(),
      providerKey: "should-never-be-persisted",
      apiKey: "also-secret",
    } as Workspace & { providerKey: string; apiKey: string };

    expect(saveWorkspace(dirty, storage)).toEqual({ ok: true });
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY)!;
    expect(raw).not.toContain("should-never-be-persisted");
    expect(raw).not.toContain("also-secret");
    expect(loadWorkspace(storage)).toEqual({...workspace(),schemaVersion:2});
  });

  it("returns null for corrupted or incompatible data without throwing", () => {
    const storage = new MemoryStorage();
    storage.setItem(WORKSPACE_STORAGE_KEY, "{not-json");
    expect(loadWorkspace(storage)).toBeNull();

    storage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ ...workspace(), schemaVersion: 999 }),
    );
    expect(loadWorkspace(storage)).toBeNull();

    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1 }));
    expect(loadWorkspace(storage)).toBeNull();
  });

  it("clears the workspace safely", () => {
    const storage = new MemoryStorage();
    saveWorkspace(workspace(), storage);
    expect(clearWorkspace(storage)).toEqual({ ok: true });
    expect(loadWorkspace(storage)).toBeNull();
  });
});

