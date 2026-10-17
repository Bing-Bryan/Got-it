// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadingLibrary } from './reading-library';
import { WebTranslations } from './web-translations';
import { serverPdfTranslationSource } from './pdf-translation-source';
import { pdfFixture } from './test-support/pdf-fixture';
import { pdfTranslationVersion } from '../src/lib/pdf-translation';

// Synthetic text only: one readable paragraph per page in a generated PDF.
const content = 'BT /F1 12 Tf 40 250 Td (The synthetic paragraph explains a reading method for the test.) Tj 0 -14 Td (It continues on a second line of the same paragraph here.) Tj ET';
let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
async function setup() {
  dir = await mkdtemp(join(tmpdir(), 'pdf-translation-'));
  const library = new ReadingLibrary(join(dir, 'library'));
  const upload = await library.uploadPdf('synthetic.pdf', pdfFixture(2, 0, false, false, content));
  const entry = await library.add(upload.workspace, 'browser', upload.selectionId);
  const doc = entry.workspace.document;
  if (doc.kind !== 'pdf') throw new Error('expected PDF');
  return { library, entry, resourceId: doc.pdf.resourceId };
}

it('rebuilds PDF units from the saved file and translates them with the PDF source version', async () => {
  const { library, entry, resourceId } = await setup();
  const source = await serverPdfTranslationSource(library, entry.id, resourceId);
  expect(source.sourceVersion).toBe(pdfTranslationVersion(resourceId));
  expect(source.source.units.map(u => u.id)).toEqual(['pdf-p1-b0--v2-part0', 'pdf-p2-b0--v2-part0']);
  expect(source.source.units[0].text).toBe('The synthetic paragraph explains a reading method for the test. It continues on a second line of the same paragraph here.');
  const translate = vi.fn(async (units: { id: string; text: string }[]) => ({ modelConfig: { model: 'gpt-6-luna', reasoningEffort: 'medium' }, units: Object.fromEntries(units.map(u => [u.id, '合成段落译文。'])) }));
  const request = { operationId: 'pdf-batch', roundId: 'round', translationId: 'translation', revisionId: entry.revisionId, sourceVersion: source.sourceVersion, unitIds: ['pdf-p1-b0--v2-part0'] };
  const result = await new WebTranslations(library, { translateWebBatch: translate as never }).batch(entry.id, request);
  expect(result.units).toEqual({ 'pdf-p1-b0--v2-part0': '合成段落译文。' });
  expect(translate.mock.calls[0][0][0].text).toContain('synthetic paragraph');
}, 15_000);

it('rejects foreign units, stale versions and other entries without calling the model', async () => {
  const { library, entry, resourceId } = await setup();
  const translate = vi.fn();
  const jobs = new WebTranslations(library, { translateWebBatch: translate });
  const request = { operationId: 'a', roundId: 'round', translationId: 'translation', revisionId: entry.revisionId, sourceVersion: pdfTranslationVersion(resourceId), unitIds: ['pdf-p9-b0--v2-part0'] };
  await expect(jobs.batch(entry.id, request)).rejects.toMatchObject({ code: 'translation_unauthorized' });
  await expect(jobs.batch(entry.id, { ...request, operationId: 'b', unitIds: ['pdf-p1-b0--v2-part0'], sourceVersion: pdfTranslationVersion('e'.repeat(64)) })).rejects.toMatchObject({ code: 'translation_version' });
  await expect(serverPdfTranslationSource(library, crypto.randomUUID(), resourceId)).rejects.toThrow();
  expect(translate).not.toHaveBeenCalled();
}, 15_000);
