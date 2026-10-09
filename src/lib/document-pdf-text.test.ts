import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({getDocument:vi.fn(),libraryBinary:vi.fn()}));
vi.mock('pdfjs-dist',()=>({getDocument:mocks.getDocument,GlobalWorkerOptions:{}}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url',()=>({default:'worker'}));
vi.mock('./library-client',()=>({libraryBinary:mocks.libraryBinary}));
import { readDocumentPdfText } from './document-pdf-text';
beforeEach(()=>{vi.clearAllMocks();mocks.libraryBinary.mockResolvedValue({arrayBuffer:async()=>new ArrayBuffer(8)});});
function pdf(texts:string[]){const destroy=vi.fn().mockResolvedValue(undefined),getPage=vi.fn(async(n:number)=>({getTextContent:async()=>({items:[{str:texts[n-1]}]}),cleanup:vi.fn()}));mocks.getDocument.mockReturnValue({promise:Promise.resolve({numPages:texts.length,getPage}),destroy});return {destroy,getPage};}
it('reads native text and reports image exclusion without rendering or OCR',async()=>{const p=pdf(['原生文字'.repeat(100),'第二页文字'.repeat(100)]);const result=await readDocumentPdfText('entry','hash',new AbortController().signal);expect(result.sections).toHaveLength(2);expect(result.notice).toContain('未读取图片');expect(p.destroy).toHaveBeenCalledOnce();});
it('rejects empty or sparse pages instead of claiming full coverage',async()=>{pdf(['原生文字'.repeat(100),'']);await expect(readDocumentPdfText('entry','hash',new AbortController().signal)).rejects.toThrow('未启动 OCR');});
it('cancels native text preparation promptly and releases its worker',async()=>{const controller=new AbortController();const destroy=vi.fn().mockResolvedValue(undefined);mocks.getDocument.mockReturnValue({promise:new Promise(()=>{}),destroy});const reading=readDocumentPdfText('entry','hash',controller.signal);await vi.waitFor(()=>expect(mocks.getDocument).toHaveBeenCalled());controller.abort();await expect(reading).rejects.toThrow();expect(destroy).toHaveBeenCalled();});
it('surfaces resource failures before loading PDF worker',async()=>{mocks.libraryBinary.mockRejectedValue(new Error('资源不可用'));await expect(readDocumentPdfText('entry','hash',new AbortController().signal)).rejects.toThrow('资源不可用');expect(mocks.getDocument).not.toHaveBeenCalled();});
