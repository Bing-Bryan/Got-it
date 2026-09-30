import { expect, it } from 'vitest';
import { readingFixture } from '../test-support/recovery-fixture';
import { parseReadingDocument, workspaceToReadingDocument } from './reading-document-core';
import { workspaceToMarkdown } from './export';
import { copyOperation } from './verification';
it('round-trips explicit web mode and legacy messages through saved reading documents',()=>{
 const w=readingFixture();w.inquiries[0].messages.push({...w.inquiries[0].messages[0],id:'web',operation:'explain',explanationMode:'web',modelConfig:{model:'gpt-6-luna',reasoningEffort:'low'},search:{status:'executed',completedSearches:1,failedSearches:0}});
 const restored=parseReadingDocument(workspaceToReadingDocument(w));expect(restored.inquiries[0].messages[0].explanationMode).toBeUndefined();expect(restored.inquiries[0].messages[1]).toMatchObject({explanationMode:'web',search:{status:'executed'},sources:[{domain:'example.com',retrievalStatus:'not-read'}],modelConfig:{model:'gpt-6-luna'}});
 expect(workspaceToMarkdown(restored)).toContain('联网补充');expect(copyOperation({explanationMode:'auto'})).toMatchObject({explanationMode:'auto'});expect(copyOperation({explanationMode:'unknown'})).not.toHaveProperty('explanationMode');
});
