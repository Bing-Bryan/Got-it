import {expect,it,vi} from 'vitest';
vi.mock('./lib/runtime-mode',()=>({HOSTED:true}));
import {renderToStaticMarkup} from 'react-dom/server';
import {ReadingRecoveryView} from './ReadingRecoveryView';
import {readingFixture,editReading} from './test-support/recovery-fixture';
import type {RecoveryRecord} from './lib/reading-recovery';
it('shows the latest current version before a second hosted recovery choice',()=>{const workspace=readingFixture();const record:RecoveryRecord={id:'r',entryId:'entry',createdAt:'2026-10-16',state:'pending',reason:'changed',previous:[],draft:{entryId:'entry',version:1,revisionId:'rev',workspace:editReading(workspace,'draft v1'),position:{ratio:0}},disk:{version:2,revisionId:'rev',workspace:editReading(workspace,'historic v2'),position:{ratio:0}},current:{version:3,revisionId:'rev',workspace:editReading(workspace,'latest v3 to confirm'),position:{ratio:0}}};const html=renderToStaticMarkup(<ReadingRecoveryView library={{recovery:record} as any}/>);expect(html).toContain('latest v3 to confirm');expect(html).not.toContain('historic v2');expect(record.disk?.version).toBe(2);});
