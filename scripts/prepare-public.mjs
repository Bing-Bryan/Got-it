// Explicit allowlist: do not copy local evidence, report files, credentials or Git history.
import { cp, mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const roots = ['src', 'server', 'scripts', '.github', 'docs/images', 'docs/updates',
  'docs/release-checklist.md', 'docs/release-results.md', 'SECURITY.md', 'LICENSE',
  'README.md', 'README.en.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'index.html', '.env.example', '.gitignore', '.nvmrc'];
const root = process.cwd();
const dest = resolve(root, 'release', `got-it-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
const files = [];
async function walk(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw Error(`Symlinks are not permitted in public snapshot: ${relative(root, path)}`);
  if (info.isDirectory()) { for (const name of await readdir(path)) await walk(join(path, name)); }
  else files.push(path);
}
for (const name of roots) await walk(resolve(root, name));
const suspicious = [/sk-[A-Za-z0-9_-]{24,}/, /gh[pousr]_[A-Za-z0-9]{30,}/, /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/, /\/Users\/[^/\s]+\//];
const manifest = [];
for (const file of files) {
  const bytes = await readFile(file);
  const name = relative(root, file).replaceAll('\\', '/');
  if (!name.endsWith('.png') && suspicious.some(pattern => pattern.test(bytes.toString()))) throw Error(`Public-content scan failed: ${name} (contents redacted)`);
  manifest.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await mkdir(dest, { recursive: true });
for (const name of roots) await cp(resolve(root, name), resolve(dest, name), { recursive: true, dereference: false });
await writeFile(join(dest, 'PUBLIC-MANIFEST.json'), JSON.stringify({ note: 'Allowlisted snapshot; no original Git history. Images reviewed separately; scan is not a security certification.', files: manifest }, null, 2) + '\n');
console.log(`Prepared ${manifest.length} files at ${dest}`);
