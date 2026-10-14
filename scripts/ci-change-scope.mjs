import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const full = reason => ({ runChecks: true, reason });
const isShowcase = path => path === 'README.md' || path === 'README.en.md'
  || /^docs\/images\/(?:[^/\r\n]+\/)*[^/\r\n]+\.png$/.test(path);

function manifestEntries(text) {
  const manifest = JSON.parse(text);
  if (!manifest || Object.keys(manifest).sort().join(',') !== 'files,note'
    || typeof manifest.note !== 'string' || !Array.isArray(manifest.files)) throw new Error('invalid_manifest');
  const entries = new Map();
  for (const entry of manifest.files) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'bytes,path,sha256'
      || typeof entry.path !== 'string' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
      || !/^[a-f0-9]{64}$/.test(entry.sha256) || entries.has(entry.path)) throw new Error('invalid_manifest');
    entries.set(entry.path, entry);
  }
  return { note: manifest.note, entries };
}

export function classifyPaths(paths, beforeManifest, afterManifest, verifyEntry) {
  if (!paths.length) return full('empty_diff');
  const showcase = new Set(paths.filter(isShowcase));
  if (!showcase.size || paths.some(path => !isShowcase(path) && path !== 'PUBLIC-MANIFEST.json')) return full('other_changes');
  if (paths.includes('PUBLIC-MANIFEST.json')) {
    try {
      const before = manifestEntries(beforeManifest), after = manifestEntries(afterManifest);
      if (before.note !== after.note) return full('manifest_metadata_changed');
      for (const path of new Set([...before.entries.keys(), ...after.entries.keys()])) {
        const a = before.entries.get(path), b = after.entries.get(path);
        if (!a || !b || a.bytes !== b.bytes || a.sha256 !== b.sha256) {
          if (!showcase.has(path)) return full('other_manifest_changes');
        }
      }
      for (const path of showcase) {
        if (!verifyEntry?.('base', path, before.entries.get(path))
          || !verifyEntry?.('head', path, after.entries.get(path))) return full('manifest_blob_mismatch');
      }
    } catch {
      return full('manifest_unavailable_or_invalid');
    }
  }
  return { runChecks: false, reason: 'readme_or_png_only' };
}

export function detectScope(eventName, event, cwd = process.cwd()) {
  if (eventName === 'workflow_dispatch') return full('manual');
  if (eventName !== 'push' && eventName !== 'pull_request') return full('unknown_event');
  let base = eventName === 'push' ? event.before : event.pull_request?.base?.sha;
  const head = eventName === 'push' ? event.after : event.pull_request?.head?.sha;
  const valid = sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha);
  if (!valid(base) || !valid(head)) return full('missing_or_initial_ref');
  const git = args => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000 });
    if (result.error || result.status !== 0) throw new Error('git_diff_unavailable');
    return result.stdout;
  };
  try {
    if (eventName === 'pull_request') base = git(['merge-base', base, head]).trim();
    // Both sides of a rename must count, including source code moved into an image path.
    const paths = git(['diff', '--no-renames', '--name-only', '-z', base, head, '--']).split('\0').filter(Boolean);
    const manifest = paths.includes('PUBLIC-MANIFEST.json');
    const verifyEntry = (side, path, entry) => {
      const result = spawnSync('git', ['show', `${side === 'base' ? base : head}:${path}`], { cwd, timeout: 10_000 });
      if (result.error || result.signal) return false;
      if (!entry) return result.status !== 0;
      return result.status === 0 && entry.bytes === result.stdout.length
        && entry.sha256 === createHash('sha256').update(result.stdout).digest('hex');
    };
    return classifyPaths(paths, manifest ? git(['show', `${base}:PUBLIC-MANIFEST.json`]) : undefined,
      manifest ? git(['show', `${head}:PUBLIC-MANIFEST.json`]) : undefined, verifyEntry);
  } catch {
    return full('git_diff_unavailable');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let decision;
  try {
    decision = detectScope(process.env.GITHUB_EVENT_NAME, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
  } catch {
    decision = full('event_unavailable');
  }
  console.log(`run_checks=${decision.runChecks}\nreason=${decision.reason}`);
}
