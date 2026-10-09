// Isolated replay of the user's archived article and real saved answers.
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';
import { ReadingLibrary } from '../server/reading-library.ts';
import { restoreWorkspace } from '../src/lib/storage.ts';
if (!process.argv.includes('--run')) { console.log('Run with node --import tsx scripts/serve-companion-walkthrough.mjs --run'); process.exit(0); }
const dir = await mkdtemp(join(tmpdir(), 'got-it-companion-'));
const library = new ReadingLibrary(dir);
const workspace = restoreWorkspace(JSON.parse(await readFile('artifacts/report-walkthrough/workspace.json', 'utf8')));
if (!workspace) throw new Error('Archived workspace is invalid');
const entry = await library.add(workspace, 'archived-real-article');
await library.activate(entry.id);
const app = createApp({ library });
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/api/inquiries')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '本次仅走查已有回答，不生成新回答。' })); return;
  }
  app(req, res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { createServer: createVite } = await import('vite');
const web = await createVite({ server: { port: 5177, strictPort: true, open: false, proxy: { '/api': { target: `http://127.0.0.1:${server.address().port}`, changeOrigin: false } } } });
await web.listen();
console.log('COMPANION_UI http://localhost:5177');
process.on('SIGINT', async () => { await web.close(); server.close(); await rm(dir, { recursive: true, force: true }); process.exit(0); });
