import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const detector = resolve('scripts/ci-change-scope.mjs');
const bash = process.platform === 'win32' ? join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : 'bash';
const shellPath = path => path.replaceAll('\\', '/');
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const workflowShell = workflow.split('        run: |\n')[1].split('\n  checks:')[0]
  .split('\n').map(line => line.slice(10)).join('\n');

function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'got-it-ci-scope-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path, content) => { mkdirSync(join(repo, path, '..'), { recursive: true }); writeFileSync(join(repo, path), content); };
  const entry = path => {
    const bytes = readFileSync(join(repo, path));
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  let paths = ['README.md', 'README.en.md', 'src/example.ts', 'package.json', 'docs/images/old.png'];
  const manifest = (mutate = value => value) => write('PUBLIC-MANIFEST.json', JSON.stringify(mutate({ note: 'fixture', files: paths.map(entry) })));
  const commit = () => { git('add', '.'); git('-c', 'user.name=CI Fixture', '-c', 'user.email=ci-fixture@example.invalid', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main');
  paths.forEach(path => write(path, `original ${path}`));
  write('scripts/ci-change-scope.mjs', readFileSync(detector));
  manifest();
  const base = commit();
  const envFor = (name, event) => {
    const eventPath = join(repo, '.git', 'event.json'); writeFileSync(eventPath, JSON.stringify(event));
    return { ...process.env, GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: eventPath };
  };
  const invoke = (name, event) => {
    const result = spawnSync(process.execPath, [detector], { cwd: repo, env: envFor(name, event), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.includes('run_checks=true');
  };
  return { repo, git, write, entry, manifest, commit, base, invoke, envFor, paths };
}

for (const [path, expected] of [
  ['README.md', false], ['README.en.md', false], ['docs/images/new.png', false],
  ['docs/images/nested/new.png', false], ['docs/images/new.PNG', true], ['docs/images/note.md', true],
  ['README.other.md', true], ['src/example.ts', true], ['package.json', true],
  ['scripts/check.mjs', true], ['.github/workflows/ci.yml', true], ['docs/release-results.md', true],
]) {
  test(`push path ${path}`, t => {
    const f = fixture(t); f.write(path, 'changed');
    assert.equal(f.invoke('push', { before: f.base, after: f.commit() }), expected);
  });
}

test('push compares every commit, not only the last README commit', t => {
  const f = fixture(t); f.write('src/example.ts', 'changed code'); f.commit(); f.write('README.md', 'changed docs');
  assert.equal(f.invoke('push', { before: f.base, after: f.commit() }), true);
});
test('cross-boundary rename retains the source-code deletion', t => {
  const f = fixture(t); renameSync(join(f.repo, 'src/example.ts'), join(f.repo, 'docs/images/new.png'));
  assert.equal(f.invoke('push', { before: f.base, after: f.commit() }), true);
});
test('PR compares merge-base to head, excluding unrelated base branch changes', t => {
  const f = fixture(t); f.git('checkout', '-qb', 'feature'); f.write('README.md', 'feature docs'); const head = f.commit();
  f.git('checkout', 'main'); f.write('src/example.ts', 'base code'); const base = f.commit();
  assert.equal(f.invoke('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }), false);
});
test('manual, initial push, missing refs, unknown event and empty diff are full', t => {
  const f = fixture(t);
  assert.equal(f.invoke('workflow_dispatch', {}), true);
  assert.equal(f.invoke('push', { before: '0'.repeat(40), after: f.base }), true);
  assert.equal(f.invoke('push', { before: 'a'.repeat(40), after: f.base }), true);
  assert.equal(f.invoke('pull_request', {}), true);
  assert.equal(f.invoke('unknown', {}), true);
  assert.equal(f.invoke('push', { before: f.base, after: f.base }), true);
});

for (const [label, mutate, expected] of [
  ['matching README entry', value => value, false],
  ['application hash tampering', value => { value.files.find(e => e.path === 'src/example.ts').sha256 = 'a'.repeat(64); return value; }, true],
  ['unchanged PNG hash tampering', value => { value.files.find(e => e.path === 'docs/images/old.png').sha256 = 'a'.repeat(64); return value; }, true],
  ['README hash does not match its blob', value => { value.files.find(e => e.path === 'README.md').sha256 = 'a'.repeat(64); return value; }, true],
  ['metadata change', value => { value.note = 'changed'; return value; }, true],
  ['unknown root field', value => ({ ...value, extra: true }), true],
  ['unknown entry field', value => { value.files[0].extra = true; return value; }, true],
  ['duplicate path', value => { value.files.push(value.files[0]); return value; }, true],
]) {
  test(`manifest with README: ${label}`, t => {
    const f = fixture(t); f.write('README.md', 'changed docs'); f.manifest(mutate);
    assert.equal(f.invoke('push', { before: f.base, after: f.commit() }), expected);
  });
}
test('manifest-only and corrupt JSON keep full checks', t => {
  const f = fixture(t); f.manifest(value => ({ ...value, note: 'changed' }));
  assert.equal(f.invoke('push', { before: f.base, after: f.commit() }), true);
  f.write('README.md', 'changed'); f.write('PUBLIC-MANIFEST.json', 'broken');
  assert.equal(f.invoke('push', { before: f.base, after: f.commit() }), true);
});
test('PNG addition and deletion are allowed only with matching manifest blobs', t => {
  const f = fixture(t); f.write('docs/images/new.png', 'new image'); f.paths.push('docs/images/new.png'); f.manifest(); const added = f.commit();
  assert.equal(f.invoke('push', { before: f.base, after: added }), false);
  rmSync(join(f.repo, 'docs/images/new.png')); f.paths.splice(f.paths.indexOf('docs/images/new.png'), 1); f.manifest();
  assert.equal(f.invoke('push', { before: added, after: f.commit() }), false);
});
test('manifest cannot remove an entry while the changed file still exists', t => {
  const f = fixture(t); f.write('README.md', 'changed'); f.manifest(value => ({ ...value, files: value.files.filter(e => e.path !== 'README.md') }));
  assert.equal(f.invoke('push', { before: f.base, after: f.commit() }), true);
});
test('README changed with reordered manifest and stale hash keeps full checks', t => {
  const f = fixture(t); const old = JSON.parse(readFileSync(join(f.repo, 'PUBLIC-MANIFEST.json'), 'utf8'));
  f.write('README.md', 'changed docs'); old.files.reverse(); f.write('PUBLIC-MANIFEST.json', JSON.stringify(old));
  assert.equal(f.invoke('push', { before: f.base, after: f.commit() }), true);
});

test('workflow executes trusted PR base detector rather than head script', t => {
  const f = fixture(t); f.write('scripts/ci-change-scope.mjs', 'throw Error("untrusted head executed");'); f.write('README.md', 'head docs'); const head = f.commit();
  const output = join(f.repo, '.git', 'output');
  const result = spawnSync(bash, ['-c', workflowShell], { cwd: f.repo, encoding: 'utf8', env: {
    ...f.envFor('pull_request', { pull_request: { base: { sha: f.base }, head: { sha: head } } }),
    BASE_SHA: f.base, RUNNER_TEMP: shellPath(join(f.repo, '.git')), GITHUB_OUTPUT: shellPath(output),
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, 'utf8'), /run_checks=true/);
  assert.doesNotMatch(result.stderr, /untrusted head executed/);
});
test('workflow detector execution failure falls back to full checks', t => {
  const f = fixture(t); f.write('scripts/ci-change-scope.mjs', 'throw Error("fixture failure");');
  const output = join(f.repo, '.git', 'output');
  const result = spawnSync(bash, ['-c', workflowShell], { cwd: f.repo, env: {
    ...f.envFor('push', { before: f.base, after: f.commit() }), GITHUB_OUTPUT: shellPath(output),
  } });
  assert.equal(result.status, 0);
  assert.match(readFileSync(output, 'utf8'), /run_checks=true\nreason=detector_failed/);
});
