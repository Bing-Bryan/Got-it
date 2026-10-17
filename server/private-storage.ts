import { closeSync, fsyncSync, openSync } from 'node:fs';
import { win32 } from 'node:path';

// Durability and privacy checks for the hosted server's private state (budget, statistics,
// signing key). Linux and macOS keep the strict POSIX rules. Windows cannot open a directory
// to fsync it and does not express access control as mode bits, so those two checks are
// skipped there; directory privacy on Windows relies on the operator's ACLs.
const posix = (platform: NodeJS.Platform) => platform !== 'win32';

export function syncDirectory(path: string, platform: NodeJS.Platform = process.platform) {
  if (!posix(platform)) return;
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function privateMode(mode: number, platform: NodeJS.Platform = process.platform) {
  return !posix(platform) || (mode & 0o077) === 0;
}

export function absolutePath(path: string, platform: NodeJS.Platform = process.platform) {
  // Windows: a drive path (C:\...) or a UNC share; root-relative "\foo" depends on the current drive.
  return posix(platform) ? path.startsWith('/') : win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|\\\\[^\\])/.test(path);
}
