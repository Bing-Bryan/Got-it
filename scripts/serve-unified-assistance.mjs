// Isolated real-article walkthrough. Uses the real local Provider, never dummy answers.
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';
import { ReadingLibrary } from '../server/reading-library.ts';
import { restoreWorkspace } from '../src/lib/storage.ts';
if (!process.argv.includes('--run')) { console.log('Opt in: node --import tsx scripts/serve-unified-assistance.mjs --run [--replay]'); process.exit(0); }
const dir = await mkdtemp(join(tmpdir(), 'got-it-unified-'));
const library = new ReadingLibrary(dir);
const path = process.argv.includes('--replay') ? 'artifacts/unified-assistance/workspace.json' : 'artifacts/report-walkthrough/workspace.json';
const workspace = restoreWorkspace(JSON.parse(await readFile(path, 'utf8')));
if (!workspace) throw new Error('Invalid saved workspace');
const entry = await library.add(workspace, 'real-article-walkthrough');
await library.activate(entry.id);
const app = createApp({ library });
const server = createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { createServer: createVite } = await import('vite');
const web = await createVite({server:{port:5178,strictPort:true,open:false,proxy:{'/api':{target:`http://127.0.0.1:${server.address().port}`,changeOrigin:false}}}});
await web.listen();
console.log('REAL_ARTICLE_UI http://localhost:5178');
process.on('SIGINT', async () => {
  // Only the explicitly selected public report and safe workspace projection are captured.
  const saved = await library.get(entry.id);
  await mkdir('artifacts/unified-assistance', {recursive:true});
  await writeFile('artifacts/unified-assistance/workspace.json', JSON.stringify(saved.workspace, null, 2)+'\n');
  await web.close(); server.close(); await rm(dir,{recursive:true,force:true}); process.exit(0);
});
