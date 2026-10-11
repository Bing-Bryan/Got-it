import type { LibrarySummary } from "./library-types";

/** Names only: source locations remain display data, never search input. */
export function searchLibraryNames(entries: readonly LibrarySummary[], query: string): LibrarySummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return [...entries]
    .sort((a, b) => a.filename.localeCompare(b.filename, "zh-CN", { numeric: true })
      || (a.path ?? "").localeCompare(b.path ?? "") || a.id.localeCompare(b.id))
    .filter(entry => entry.filename.toLocaleLowerCase().includes(needle));
}
