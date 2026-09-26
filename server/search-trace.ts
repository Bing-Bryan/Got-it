import type { SearchTrace } from "../src/types";

/** Recognizes the Codex 0.153.x event contract; never trusts agent text. */
export function parseSearchTrace(output: string): SearchTrace {
  let started = false, complete = false, uncertain = false;
  const successes = new Set<string>(), failures = new Set<string>();
  const pending = new Set<string>();
  for (const line of output.split("\n").filter((line) => line.trim())) {
    try {
      const event = JSON.parse(line);
      if (event.type === "turn.started") started = true;
      else if (event.type === "turn.completed") complete = true;
      else if (event.type === "turn.failed" || event.type === "error") uncertain = true;
      else if (event.type === "thread.started") { /* known lifecycle */ }
      else if (["item.started", "item.updated", "item.completed"].includes(event.type)) {
        const item = event.item;
        if (!item || typeof item.type !== "string") { uncertain = true; continue; }
        if (item.type !== "web_search") {
          if (!["agent_message", "reasoning", "command_execution", "file_change", "mcp_tool_call", "todo_list"].includes(item.type)) uncertain = true;
          continue;
        }
        if (typeof item.id !== "string") { uncertain = true; continue; }
        if (event.type !== "item.completed") { pending.add(item.id); continue; }
        pending.delete(item.id);
        if (item.status === "failed" || item.error) { failures.add(item.id); continue; }
        if (item.status && item.status !== "completed") { uncertain = true; continue; }
        // An open-page action is not counted as a successful search query.
        if (item.action?.type === "search" && (typeof item.action.query === "string" || Array.isArray(item.action.queries))) successes.add(item.id);
        else if (!["open_page", "find_in_page", "other"].includes(item.action?.type)) uncertain = true;
      } else uncertain = true;
    } catch { uncertain = true; }
  }
  return {
    status: !started || !complete || uncertain || pending.size ? "unknown" : successes.size ? "executed" : failures.size ? "failed" : "not-executed",
    completedSearches: successes.size, failedSearches: failures.size,
  };
}

/** Only emits recognized search lifecycle, never model text or raw logs. */
export function observeSearchLines(emit: (progress: "search-started" | "search-completed") => void): (chunk: string) => void {
  let buffer = "", stopped = false;
  const seen = new Set<string>();
  return chunk => {
    if (stopped) return;
    buffer += chunk;
    if (buffer.length > 256 * 1024) { stopped = true; buffer = ""; return; }
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const e = JSON.parse(line);
        if (e.item?.type !== "web_search" || typeof e.item.id !== "string") continue;
        const progress = e.type === "item.started" ? "search-started" : e.type === "item.completed" && e.item.action?.type === "search" && !e.item.error && (!e.item.status || e.item.status === "completed") ? "search-completed" : undefined;
        const key = `${e.item.id}:${progress}`;
        if (progress && !seen.has(key)) { seen.add(key); emit(progress); }
      } catch { /* incomplete/unknown records cannot assert progress */ }
    }
  };
}
