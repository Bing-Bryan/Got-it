/** Conservative local signal, not a general language detector. Unknown stays manual. */
export function confidentlyEnglish(text:string):boolean {
  const words=text.toLowerCase().match(/[a-z]+/g)??[];
  const letters=(text.match(/[A-Za-z]/g)??[]).length;
  if(words.length<30||letters<100||(text.match(/[\u4e00-\u9fff]/g)??[]).length>letters/10||/[\u00c0-\u024f]/.test(text))return false;
  const common=new Set(['the','and','of','to','in','is','with','for','that','as','this','are','from','not','be','by','it','we','you','a','an']);
  const hits=words.filter(word=>common.has(word));
  return new Set(hits).size>=6&&hits.length/words.length>=.08;
}
