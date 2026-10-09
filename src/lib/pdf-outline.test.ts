import {expect,it} from 'vitest';
import {copyOutline,mergeOutlineLines,pageHeading,type OutlineLine} from './pdf-outline';
const line=(text:string,y:number,height:number,x=.03):OutlineLine=>({text,x,y,height,width:.3});
it('keeps a page heading instead of large text in a chart or photograph',()=>{
 const r=pageHeading([line('原 有 标 题',.04,.025),line('第一段正文，包含正常内容',.09,.015),line('第二段正文',.12,.015),line('PHOTO AD',.3,.1)],5,'ocr');
 expect(r).toMatchObject({title:'原有标题',page:5,level:2,source:'ocr'});
});
it('joins title fragments and consecutive cover lines without inventing text',()=>{
 const lines=[line('2028',.23,.08,.08),{...line('年度报告',.23,.08,.4),width:.2},line('原有副标题',.34,.08,.08)];
 expect(pageHeading(lines,2,'native')).toMatchObject({title:'2028 年度报告 原有副标题',level:1,page:2});
});
it('does not treat uniform body copy, page numbers or footer as a title',()=>{
 expect(pageHeading([line('普通正文',.1,.015),line('下一行正文',.13,.015),line('12',.9,.03)],1,'ocr')).toBeNull();
 expect(pageHeading([line('42',.2,.07)],1,'native')).toBeNull();
});
it('keeps columns apart and orders lines geometrically',()=>{
 const r=mergeOutlineLines([{...line('左栏',.1,.02),width:.1},line('右栏',.1,.02,.7)]);expect(r).toHaveLength(2);
});
it('validates hash, page bounds, duplicate ids and strips extra properties',()=>{
 const hash='a'.repeat(64),item={id:'a',title:'章节',page:2,top:.1,level:1,source:'manual'};
 const data={version:1,fileHash:hash,revision:0,reviewed:false,items:[item],secret:'not persisted'};
 expect(copyOutline(data,hash,3)).not.toHaveProperty('secret');
 for(const change of [{fileHash:'b'.repeat(64)},{items:[{...item,page:4}]},{items:[item,item]},{items:[{...item,top:NaN}]},{items:[{...item,title:''}]}])expect(()=>copyOutline({...data,...change},hash,3)).toThrow();
});
it('recognizes an early standalone heading on an image-heavy page and ignores a graph paragraph',()=>{
 expect(pageHeading([line('案例标题',.044,.024),line('图片中的大字',.2,.06),line('另一张图',.4,.07)],12,'ocr')).toMatchObject({title:'案例标题',level:2});
 expect(pageHeading([line('在某些市场长期统计中出现的多项指标与观点',.18,.019),line('图表中的解释性文字',.22,.019)],35,'ocr')).toBeNull();
});
it('merges near-baseline title fragments in left-to-right order',()=>{
 expect(pageHeading([{...line('Brand',.15,.09,.2),width:.28},{...line('关于',.16,.077,.04),width:.15}],40,'native')?.title).toBe('关于 Brand');
});
