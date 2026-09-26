import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Use the desktop distribution for both discovery and execution; explicit overrides still win. */
export function resolveCodexBinary(configured?: string, platform = process.platform, executable = (path: string) => {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}): string {
  if (configured?.trim()) return configured.trim();
  if (platform === 'darwin') {
    for (const root of ['/Applications', join(homedir(), 'Applications')]) {
      for (const app of ['Codex.app', 'ChatGPT.app']) {
        const binary = join(root, app, 'Contents/Resources/codex');
        if (executable(binary)) return binary;
      }
    }
  }
  return 'codex';
}
