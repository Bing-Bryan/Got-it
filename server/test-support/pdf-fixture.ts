/** Safe generated fixture: no external report or extracted report text. */
export function pdfFixture(pages=1, rotation=0, crop=false, encrypted=false): Buffer {
 const objects:string[]=['<< /Type /Catalog /Pages 2 0 R >>',''];
 const children:number[]=[];
 for(let n=0;n<pages;n++){
   const pageId=objects.length+1;children.push(pageId);
   const content=`BT /F1 18 Tf 70 250 Td (SYNTHETIC CHART ${n+1}) Tj 0 -35 Td (Alpha 10   Beta 20   Gamma 30) Tj ET\n0.3 0.25 0.8 rg 70 60 50 40 re f 150 60 50 80 re f 230 60 50 120 re f`;
   objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] ${crop?'/CropBox [20 20 380 280]':''} /Rotate ${rotation} /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${pageId+1} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
 }
 objects[1]=`<< /Type /Pages /Count ${pages} /Kids [${children.map(n=>n+' 0 R').join(' ')}] >>`;
 if(encrypted)objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> >>`);
 let text='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R ${encrypted?`/Encrypt ${objects.length} 0 R /ID [<${'00'.repeat(16)}> <${'00'.repeat(16)}>]`:''} >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(text);
}
