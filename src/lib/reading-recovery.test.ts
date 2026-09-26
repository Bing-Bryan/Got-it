import { describe,it,expect,beforeEach } from 'vitest';
import { DraftStore, readingContent, readingKey, LEGACY_DRAFT_KEY, sameOriginal } from './reading-recovery';
import { readingFixture, editReading } from '../test-support/recovery-fixture';
import type { LibraryEntry } from './library-types';
import { restoreWorkspace } from './storage';
const e=():LibraryEntry=>({id:'entry',revisionId:'revision',version:1,workspace:readingFixture(),position:{ratio:0},source:null,history:[],updatedAt:'2026',lastOpenedAt:'2026',creationKey:'fixture'});
beforeEach(()=>localStorage.clear());
describe('recovery comparison and emergency drafts',()=>{
 it('ignores navigation/preferences/timestamps, but never hides content, source, learning or original changes',()=>{
  const a=readingFixture(),b=structuredClone(a);b.updatedAt='later';b.inquiries[0].updatedAt='later';b.activeInquiryId='i';b.activeProviderId='demo';
  expect(readingContent(a)).toBe(readingContent(b));expect(readingKey(a,{ratio:0})).not.toBe(readingKey(b,{ratio:0}));
  expect(readingContent(editReading(a,'不同回答'))).not.toBe(readingContent(a));
  b.inquiries[0].status='understood';expect(readingContent(a)).not.toBe(readingContent(b));b.inquiries[0].status='ready';
  b.inquiries[0].messages[0].sources![0].retrievalStatus='matched';expect(readingContent(a)).not.toBe(readingContent(b));
  const entry=e();expect(sameOriginal(entry,{...entry,entryId:entry.id,revisionId:'other'})).toBe(false);
 });
 it('normalizes interrupted content without changing the evidence result',()=>{
  const a=readingFixture();a.inquiries[0].status='answering';a.inquiries[0].messages[0].completion='provisional';
  const b=restoreWorkspace(a)!;expect(readingContent(a)).toBe(readingContent(b));expect(b.inquiries[0].messages[0].evidenceStatus).toBe('partial');
 });
 it('isolates owners/entries and does not remove newer drafts with an old acknowledgement',()=>{
  const a=new DraftStore(localStorage,'a'),b=new DraftStore(localStorage,'b'),entry=e();
  const old=a.write(entry,entry.workspace,{ratio:0});a.write(entry,editReading(entry.workspace,'新回答'),{ratio:0});b.write(entry,entry.workspace,{ratio:.4});
  a.remove(old);expect(a.read().drafts).toHaveLength(2);
  expect(new DraftStore(localStorage).read().drafts.some(d=>d.draft.workspace.inquiries[0].messages[0].content==='新回答')).toBe(true);
 });
 it('reads a legacy draft without deleting damaged or unconfirmed data',()=>{
  const entry=e();localStorage.setItem(LEGACY_DRAFT_KEY,JSON.stringify({...entry,entryId:entry.id}));
  localStorage.setItem('got-it.library.draft.v2.broken','not json');const store=new DraftStore(localStorage);
  const data=store.read();expect(data.invalid).toBe(true);expect(data.drafts).toHaveLength(1);store.remove(data.drafts[0]);
  expect(localStorage.getItem('got-it.library.draft.v2.broken')).toBe('not json');
 });
});
