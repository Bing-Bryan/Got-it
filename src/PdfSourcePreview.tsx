import { useEffect, useState } from 'react';
import { libraryBinary } from './lib/library-client';
import type { Inquiry } from './types';
export function PdfSourcePreview({entryId,inquiry,onJump,onCorrect,disabled=false}:{entryId:string;inquiry:Inquiry;onJump:()=>void;onCorrect?:(text:string)=>void;disabled?:boolean}) {
 const a=inquiry.anchor.pdf!;
 const [open,setOpen]=useState(false),[url,setUrl]=useState(''),[error,setError]=useState('');
 const [text,setText]=useState(a.context??a.originalText??'');
 useEffect(()=>{setText(a.context??a.originalText??'');},[inquiry.id,a.context,a.originalText]);
 useEffect(()=>{if(!open||!a.cropId)return;let disposed=false,objectUrl='';setUrl('');setError('');void(async()=>{try{const response=await libraryBinary(`/entries/${entryId}/resources/${a.cropId}`);objectUrl=URL.createObjectURL(await response.blob());if(!disposed)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);}catch{if(!disposed)setError('裁图无法读取，原回答仍可查看。');}})();return()=>{disposed=true;URL.revokeObjectURL(objectUrl);};},[open,entryId,a.cropId]);
 return <div className="pdf-source-preview">
   <button type="button" onClick={onJump}>回到第 {a.page} 页原处</button>
   {a.cropId?<details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>查看所选内容</summary>{url?<img src={url} alt="已保存的原页选区"/>:null}{error?<p role="alert">{error}</p>:null}</details>:null}
   {a.ocrId?<details><summary>查看与纠正识别文字</summary><p>识别文字可能有误，请对照原图；修正后重新回答会保留旧回答。</p><textarea aria-label="修正识别文字" maxLength={4000} value={text} readOnly={!onCorrect||disabled} onChange={e=>setText(e.target.value)}/>{onCorrect?<button type="button" disabled={disabled||!text.trim()||text.trim()===(a.context??a.originalText??'').trim()} onClick={()=>onCorrect(text.trim())}>用修正文字重新回答</button>:null}</details>:a.cropId?<small>未提取到辅助文字，本轮依据原图处理。</small>:null}
 </div>;
}
