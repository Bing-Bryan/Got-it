import {expect,it} from 'vitest';
import {renderMarkdown} from '../src/lib/markdown';import {createAnchor} from '../src/lib/anchors';import {createInitialWorkspace} from '../src/sample';import {bookmarkSourceBlocks,exactBookmarkRange} from './bookmark-source';
it('accepts real browser-rendered ranges after sanitized hidden nodes and preserves visible code/legacy marker offsets',()=>{
 const cases=[
  {markdown:'<p>visible-before<script>HIDDEN_TEXT</script>visible-after</p>',quote:'visible-after'},
  {markdown:'<p>visible-before<iframe>HIDDEN_FRAME</iframe>visible-after</p>',quote:'visible-after'},
  {markdown:'before **visible** ==after== and `<script>literal</script>`',quote:'after'},
  {markdown:'<p>before<code>==literal==</code> after</p>',quote:'after'},
 ];
 for(const c of cases){const workspace=createInitialWorkspace();workspace.document={id:workspace.document.id,filename:workspace.document.filename,importedAt:workspace.document.importedAt,contentHash:workspace.document.contentHash,kind:'markdown',markdown:c.markdown,isDemo:false};const dom=document.createElement('article');dom.innerHTML=renderMarkdown(c.markdown).html;const block=[...dom.querySelectorAll<HTMLElement>('[data-block-id]')].find(n=>n.textContent?.includes(c.quote))!,blockText=block.textContent!,start=blockText.indexOf(c.quote),anchor=createAnchor({documentId:workspace.document.id,blockId:block.dataset.blockId!,blockText,start,end:start+c.quote.length})!;
  expect(bookmarkSourceBlocks(workspace).get(anchor.blockId),c.markdown).toBe(blockText);expect(exactBookmarkRange(bookmarkSourceBlocks(workspace).get(anchor.blockId),anchor),c.markdown).toBe(true);
 }
});
