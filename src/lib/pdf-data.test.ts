import {expect,it} from 'vitest';
import {copyPdfLocation,copyOcr,insidePage,type PdfLocation} from './pdf-data';
import {sameAnchor} from './inquiry-tabs';
import type {Anchor} from '../types';
const location:PdfLocation={kind:'text',source:'native',fileHash:'a'.repeat(64),page:1,rects:[[10,10,50,30]]};
it('rejects non-finite/empty geometry and references belonging to another anchor kind',()=>{
 for(const value of [{...location,rects:[[NaN,10,50,30]]},{...location,rects:[[50,10,50,30]]},{...location,page:0},{...location,cropId:'b'.repeat(64)},{...location,ocrId:'b'.repeat(64)},{...location,source:'ocr'},{...location,kind:'region',source:'image'}])expect(copyPdfLocation(value)).toBeUndefined();
 expect(insidePage([-1,0,30,30],{view:[0,0,400,300],rotation:0})).toBe(false);expect(copyOcr({version:1,fileHash:location.fileHash,page:1,lines:[null]})).toBeUndefined();
});
it('never merges repeated words from different PDF files, pages or rectangles',()=>{
 const a:Anchor={documentId:'doc',blockId:'block',headingPath:[],quote:'same words',prefix:'',suffix:'',start:0,end:10,matchStatus:'matched',pdf:location};
 expect(sameAnchor(a,structuredClone(a))).toBe(true);
 for(const pdf of [{...location,fileHash:'b'.repeat(64)},{...location,page:2},{...location,rects:[[60,10,100,30]] as [number,number,number,number][]}])expect(sameAnchor(a,{...a,pdf})).toBe(false);
});
