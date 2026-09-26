// Exercises the built page and real HTTP server; never invokes a model or user's library.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
const dir = await mkdtemp(join(tmpdir(), 'got-it-smoke-'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child;
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--open'], {
    env: { ...process.env, PORT: String(port), BROWSER: 'none', GOT_IT_DATA_DIR: dir,
      CODEX_CLI_PATH: join(dir, 'intentionally-missing-codex') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(`Server exited: ${output}`);
    try { const r = await fetch(base, { signal: AbortSignal.timeout(500) }); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Server startup exceeded 10 seconds');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited; clearTimeout(timer);
}
const request = (path, init = {}) => fetch(base + path, { ...init, signal: AbortSignal.timeout(5000) });
try {
  await start();
  const html = await (await request('/')).text();
  assert.match(html, /id="root"/);
  const assets = [...html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)].map(m => m[1]);
  assert.ok(assets.length >= 2);
  for (const asset of assets) assert.equal((await request(asset)).status, 200);
  assert.equal((await request('/api/nonexistent')).status, 404);
  assert.equal((await request('/api/library/')).status, 401);
  assert.equal((await request('/api/library/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{}' })).status, 403);
  const session = await request('/api/library/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(session.status, 200);
  const { token } = await session.json();
  assert.equal((await request('/api/library/', { headers: { 'X-Got-It-Session': token } })).status, 200);
  assert.equal((await request('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  const providers = await request('/api/providers');
  assert.equal(providers.status, 200);
  const providerBody = await providers.json();
  assert.equal(providerBody.providers.find(p => p.id === "codex").availability, "unavailable");
  await stop(); await start();
  assert.equal((await request('/api/library/', { headers: { 'X-Got-It-Session': token } })).status, 401);
  console.log('PASS: built HTML/assets, API errors, local-origin/session guard, missing Codex, restart/session invalidation. No model calls.');
} finally { await stop(); await rm(dir, { recursive: true, force: true }); }
