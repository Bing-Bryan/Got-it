import { afterEach, expect, it, vi } from 'vitest';
import { revealReadingTarget } from './reading-navigation';
const rect=(top:number,bottom:number)=>({top,bottom,height:bottom-top,left:0,right:500,width:500,x:0,y:top,toJSON:()=>({})});
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
it.each([[150,180,0],[70,90,-38],[480,520,28],[150,850,0]])('minimally reveals %s..%s below reader tools', (top,bottom,delta)=>{
 const scroll=document.createElement('div');scroll.className='reader-scroll';const tools=document.createElement('div');tools.className='pdf-toolbar';const target=document.createElement('mark');scroll.append(tools,target);document.body.append(scroll);
 vi.spyOn(scroll,'getBoundingClientRect').mockReturnValue(rect(50,500));vi.spyOn(tools,'getBoundingClientRect').mockReturnValue(rect(50,100));vi.spyOn(target,'getBoundingClientRect').mockReturnValue(rect(top,bottom));scroll.scrollTop=200;
 expect(revealReadingTarget(target)).toBe(true);expect(scroll.scrollTop).toBe(200+delta);
});
