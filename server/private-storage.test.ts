// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { absolutePath, privateMode, syncDirectory } from './private-storage';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

it('keeps the strict POSIX rules on Linux and macOS', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    expect(absolutePath('/srv/state/budget.json', platform)).toBe(true);
    expect(absolutePath('state/budget.json', platform)).toBe(false);
    expect(absolutePath('C:\\state\\budget.json', platform)).toBe(false);
    expect(privateMode(0o100600, platform)).toBe(true);
    expect(privateMode(0o40700, platform)).toBe(true);
    expect(privateMode(0o100644, platform)).toBe(false);
    expect(privateMode(0o40750, platform)).toBe(false);
  }
});

// Opening a directory to fsync it only works on the host's own POSIX file system.
it.skipIf(process.platform === 'win32')('flushes a real directory on POSIX and reports a missing one', () => {
  dir = mkdtempSync(join(tmpdir(), 'private-storage-'));
  expect(() => syncDirectory(dir)).not.toThrow();
  expect(() => syncDirectory(join(dir, 'missing'))).toThrow();
});

it('accepts Windows absolute paths and skips mode bits and directory fsync there', () => {
  expect(absolutePath('C:\\ProgramData\\got-it\\budget.json', 'win32')).toBe(true);
  expect(absolutePath('\\\\server\\share\\budget.json', 'win32')).toBe(true);
  expect(absolutePath('state\\budget.json', 'win32')).toBe(false);
  expect(absolutePath('C:budget.json', 'win32')).toBe(false);
  expect(absolutePath('\\state\\budget.json', 'win32')).toBe(false);
  expect(absolutePath('/state/budget.json', 'win32')).toBe(false);
  expect(absolutePath('D:/state/budget.json', 'win32')).toBe(true);
  expect(privateMode(0o100666, 'win32')).toBe(true);
  // A path that would throw if opened proves the Windows branch never opens it.
  expect(() => syncDirectory(join(tmpdir(), 'private-storage-missing-' + process.pid), 'win32')).not.toThrow();
});
