import {it,expect} from 'vitest';
import sharp from 'sharp';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseXArticleCapture,extractXArticle,xMediaUrl} from './x-article-capture';
import {WebImports} from './web-imports';
import {ReadingLibrary} from './reading-library';
const capture=()=>({format:'got-it-x-article',version:1,url:'https://x.com/i/article/123',title:'Safe sample article',nodes:[{type:'paragraph',children:[{type:'text',text:'Safe sample prose. '.repeat(20)}]},{type:'heading',level:2,children:[{type:'text',text:'Chapter'}]},{type:'paragraph',children:[{type:'text',text:'More safe prose. '.repeat(20)}]},{type:'image',url:'https://pbs.twimg.com/media/Sample?format=png&name=large',alt:'Sample image'}]});
it('strictly rejects untrusted fields, unsafe links, depth, shape and budgets before any read',()=>{
 for(const field of['html','markdown','workspace','cookie','complete','resourceId'])expect(()=>parseXArticleCapture({...capture(),[field]:'untrusted'})).toThrow();
 for(const url of['http://pbs.twimg.com/media/a','https://pbs.twimg.com/profile_images/a','https://pbs.twimg.com/media/a?token=secret','https://127.0.0.1/media/a','https://pbs.twimg.com/media/a?format=svg','https://pbs.twimg.com/media/a?name=large&name=small'])expect(()=>xMediaUrl(url)).toThrow();
 const c=capture();c.nodes.push({type:'link',url:'javascript:alert(1)',children:[{type:'text',text:'unsafe'}]} as never);expect(()=>parseXArticleCapture(c)).toThrow();
 let n:any={type:'text',text:'deep'};for(let i=0;i<14;i++)n={type:'quote',children:[n]};expect(()=>parseXArticleCapture({...capture(),nodes:[n]})).toThrow();
 expect(()=>parseXArticleCapture({...capture(),title:'x'.repeat(3*1024*1024)})).toThrow();
 expect(()=>parseXArticleCapture({...capture(),nodes:[] })).toThrow();
});
it('generates safe Markdown and local media in source order, checking final response URL and image bytes',async()=>{
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer();
 const parsed=parseXArticleCapture(capture());parsed.nodes[0].children![0].text='<script> ![private](got-it-media:stolen)';
 const result=await extractXArticle(parsed,{signal:new AbortController().signal,fetcher:async url=>({url,bytes,type:'image/png'})});
 if(result.workspace.document.kind!=='web')throw Error();
 expect(result.workspace.document.markdown).toContain('\\<script\\>');expect(result.workspace.document.markdown).toContain('\\!\\[private\\]');expect(result.workspace.document.markdown.indexOf('## Chapter')).toBeLessThan(result.workspace.document.markdown.lastIndexOf('got-it-media:'));expect(result.resources.size).toBe(1);
 const failed=await extractXArticle(parseXArticleCapture(capture()),{signal:new AbortController().signal,fetcher:async()=>({url:'https://other.example/media/a',bytes,type:'image/png'})});
 expect(failed.workspace.document.kind==='web'&&failed.workspace.document.web.media[0].status).toBe('missing');
});
it('uses canonical duplicate, cancellation and stable save retry with the existing job lifecycle',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'x-capture-test-'));try{
 const library=new ReadingLibrary(dir),jobs=new WebImports(library);const c=capture();c.nodes=c.nodes.filter(n=>n.type!=='image');
 await jobs.startCapture(c,'first');await new Promise(r=>setTimeout(r,10));const ready=jobs.status('first');expect(ready.status).toBe('ready');
 const saved=await jobs.confirm('first',ready.preview!.candidateId,'stable',false);expect(await jobs.confirm('first','lost-response','stable',false)).toEqual(saved);
 const duplicate=await jobs.startCapture({...c,url:'https://twitter.com/i/article/123/'},'repeat');expect(duplicate.status).toBe('existing');expect(duplicate.entryId).toBe(saved.id);
 await jobs.startCapture({...c,url:'https://x.com/i/article/456'},'cancel');jobs.cancel('cancel');await new Promise(r=>setTimeout(r,10));expect(jobs.status('cancel').status).toBe('cancelled');expect((await library.list()).entries).toHaveLength(1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('refuses even explicitly requested partial X captures when a required picture failed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'x-capture-partial-'));try{const library=new ReadingLibrary(dir),jobs=new WebImports(library,undefined,undefined,undefined,(capture,options)=>extractXArticle(capture,{...options,fetcher:async()=>{throw Error('controlled missing image');}}));await jobs.startCapture(capture(),'missing');await new Promise(r=>setTimeout(r,10));const ready=jobs.status('missing');expect(ready.status).toBe('ready');await expect(jobs.confirm('missing',ready.preview!.candidateId,'partial',true)).rejects.toMatchObject({code:'web_partial'});expect((await library.list()).entries).toHaveLength(0);}finally{await rm(dir,{recursive:true,force:true});}
});
it('preserves hostile Markdown-looking prose as paragraphs and inline code in the final parsed document',async()=>{
 const {marked}=await import('marked');const {parseFragment}=await import('parse5');
 const c=capture();c.nodes=c.nodes.filter(n=>n.type!=='image');c.nodes[0].children=[{type:'text',text:'Value &copy; &#65;\n===\n\n- not a list\n\n    not code\n+ also prose'},{type:'code',text:'first\n\n[click](https://example.org)\n\nlast'}];
 const result=await extractXArticle(parseXArticleCapture(c),{signal:new AbortController().signal});if(result.workspace.document.kind!=='web')throw Error();
 const html=String(await marked.parse(result.workspace.document.markdown)),root=parseFragment(html);const tags:string[]=[];function walk(n:any){if(n.tagName)tags.push(n.tagName);for(const child of n.childNodes??[])walk(child);}walk(root);
 expect(tags.filter(t=>t==='h1')).toHaveLength(1);expect(tags).not.toContain('ul');expect(tags).not.toContain('a');expect(tags).not.toContain('pre');expect(tags).toContain('code');expect(html).toContain('first [click](https://example.org) last');expect(html).toContain('&amp;copy; &amp;#65;');
});
