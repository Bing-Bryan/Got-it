import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { libraryBinary } from './library-client';
import { abortable } from './abortable';
import { readingLoad } from './reading-time';
import type { DocumentSection } from './document-question';
GlobalWorkerOptions.workerSrc = workerUrl;
export async function readDocumentPdfText(entryId: string, hash: string, inputSignal: AbortSignal) {
  const signal = AbortSignal.any([inputSignal, AbortSignal.timeout(60_000)]);
  const response = await abortable(libraryBinary(`/entries/${entryId}/resources/${hash}`),signal);
  const bytes = await abortable(response.arrayBuffer(),signal); signal.throwIfAborted();
  const task=getDocument({data:new Uint8Array(bytes),cMapUrl:'/pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-assets/standard_fonts/',wasmUrl:'/pdf-assets/wasm/',enableXfa:false});
  const stop=()=>{void task.destroy().catch(()=>{});};signal.addEventListener('abort',stop,{once:true});
  try {
    const pdf=await abortable(task.promise,signal), sections:DocumentSection[]=[];
    let readable=0,characters=0;
    for(let page=1;page<=pdf.numPages;page++) {
      signal.throwIfAborted();
      const p=await abortable(pdf.getPage(page),signal), content=await abortable(p.getTextContent(),signal);
      const text=content.items.map(item=>'str' in item?item.str:'').join(' ');
      const count=readingLoad(text).characters;characters+=count;if(count>=50)readable++;
      sections.push({label:`第 ${page} 页`,text});p.cleanup();
      await abortable(new Promise<void>(resolve=>setTimeout(resolve,0)),signal);
    }
    signal.throwIfAborted();
    if(readable/pdf.numPages<.8||characters/pdf.numPages<100)throw new Error('这份 PDF 的原生文字不足，暂时无法针对全文回答。可以选中文字或框选具体区域提问；本次未启动 OCR。');
    return {sections,notice:`仅参考 PDF 文字层，未读取图片内容。${readable<pdf.numPages?`可用文字覆盖 ${readable}/${pdf.numPages} 页。`:''}`};
  } finally { signal.removeEventListener('abort',stop);await task.destroy().catch(()=>{}); }
}
