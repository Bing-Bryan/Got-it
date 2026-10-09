import {expect,it,vi,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({doc:vi.fn(),worker:vi.fn(),binary:vi.fn(),destroy:vi.fn()}));
vi.mock('pdfjs-dist',()=>({GlobalWorkerOptions:{},Util:{transform:(_a:unknown,b:unknown)=>b},getDocument:()=>({promise:Promise.resolve(m.doc()),destroy:m.destroy})}));
vi.mock('tesseract.js',()=>({createWorker:m.worker,PSM:{AUTO:'3'}}));
vi.mock('./library-client',()=>({libraryBinary:m.binary}));
import {generatePdfOutline} from './generate-pdf-outline';
beforeEach(()=>{m.binary.mockResolvedValue({arrayBuffer:async()=>new ArrayBuffer(1)});m.destroy.mockReset().mockResolvedValue(undefined);m.worker.mockReset();});
it('uses internal bookmarks with valid destinations and never starts OCR',async()=>{
 m.doc.mockReturnValue({numPages:4,getOutline:async()=>[{title:'Chapter A',dest:'chapter',items:[{title:'External link',url:'https://example.com',items:[]}]}],getDestination:async()=>[2,{name:'XYZ'},0,80],getPage:async()=>({getViewport:()=>({height:100,convertToViewportPoint:(_x:number,y:number)=>[0,100-y]})})});
 const items=await generatePdfOutline('entry','a'.repeat(64),new AbortController().signal,vi.fn());expect(items).toMatchObject([{title:'Chapter A',page:3,top:.2,source:'bookmark'}]);expect(m.worker).not.toHaveBeenCalled();expect(m.destroy).toHaveBeenCalled();
});
it('does not fetch or process a PDF after cancellation',async()=>{
 const c=new AbortController();c.abort(new Error('取消'));await expect(generatePdfOutline('entry','a'.repeat(64),c.signal,vi.fn())).rejects.toThrow('取消');expect(m.worker).not.toHaveBeenCalled();
});
it('prefers a valid full-page heading and uses the top band only when needed',async()=>{
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:()=>{}} as never);
 const result={data:{blocks:[{paragraphs:[{lines:[{text:'原文标题',confidence:96,bbox:{x0:3,y0:4,x1:40,y1:7},words:[{confidence:96,bbox:{x0:3,y0:4,x1:40,y1:7}}]}]}]}]}};
 const recognize=vi.fn().mockResolvedValue(result),terminate=vi.fn().mockResolvedValue(undefined);
 m.worker.mockResolvedValue({recognize,terminate,setParameters:async()=>{}});
 m.doc.mockReturnValue({numPages:1,getOutline:async()=>null,getPage:async()=>({getViewport:()=>({width:100,height:100,transform:[]}),getTextContent:async()=>({items:[]}),render:()=>({promise:Promise.resolve(),cancel:()=>{}}),cleanup:()=>{}})});
 expect(await generatePdfOutline('entry','a'.repeat(64),new AbortController().signal,vi.fn())).toMatchObject([{title:'原文标题',source:'ocr'}]);expect(recognize).toHaveBeenCalledTimes(1);
 recognize.mockClear().mockResolvedValueOnce({data:{blocks:[]}}).mockResolvedValueOnce(result);
 expect(await generatePdfOutline('entry','a'.repeat(64),new AbortController().signal,vi.fn())).toMatchObject([{title:'原文标题'}]);expect(recognize).toHaveBeenCalledTimes(2);vi.restoreAllMocks();
});
