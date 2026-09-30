import { mkdir, mkdtemp, cp, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Installation is networked through npm; reading/OCR uses only these local files.
await mkdir('public', { recursive: true });
const staging = await mkdtemp('public/.pdf-assets-');
try {
  await cp('node_modules/tesseract.js/dist/worker.min.js', join(staging, 'worker.min.js'));
  for (const name of await readdir('node_modules/tesseract.js-core')) {
    if (name.includes('lstm') && /\.(js|wasm)$/.test(name)) {
      await cp(join('node_modules/tesseract.js-core', name), join(staging, name));
    }
  }
  for (const lang of ['eng', 'chi_sim']) {
    const pkg = `node_modules/@tesseract.js-data/${lang}`;
    await cp(`${pkg}/4.0.0/${lang}.traineddata.gz`, join(staging, `${lang}.traineddata.gz`));
    await cp(`${pkg}/package.json`, join(staging, `${lang}-package.json`));
  }
  for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
    await cp(`node_modules/pdfjs-dist/${dir}`, join(staging, dir), { recursive: true });
  }
  for (const [pkg, file] of [['pdfjs-dist', 'LICENSE'], ['tesseract.js', 'LICENSE.md'], ['tesseract.js-core', 'LICENSE']]) {
    await cp(`node_modules/${pkg}/${file}`, join(staging, `${pkg}-LICENSE`));
  }
  await cp('scripts/licenses/tessdata-LICENSE', join(staging, 'tessdata-LICENSE'));
  const manifest = {};
  async function digest(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await digest(join(directory, entry.name), relative + '/');
      else manifest[relative] = createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex');
    }
  }
  await digest(staging);
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await rm('public/pdf-assets', { recursive: true, force: true });
  await rename(staging, 'public/pdf-assets');
  console.log(`Prepared ${Object.keys(manifest).length} local PDF/OCR assets with SHA-256 manifest.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
