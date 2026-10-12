/** Conservative local signal, not a general language detector. Unknown stays manual. */
export function confidentlyEnglish(text:string):boolean {
  const words=text.toLowerCase().match(/[a-z]+/g)??[];
  const letters=(text.match(/[A-Za-z]/g)??[]).length;
  if(words.length<30||letters<100||(text.match(/[\u4e00-\u9fff]/g)??[]).length>letters/10||/[\u00c0-\u024f]/.test(text))return false;
  const common=new Set(['the','and','of','to','in','is','with','for','that','as','this','are','from','not','be','by','it','we','you','a','an']);
  const hits=words.filter(word=>common.has(word));
  return new Set(hits).size>=6&&hits.length/words.length>=.08;
}
/** Conservative Chinese prose signal for the initial manual action only; unknown/mixed stays available. */
export function confidentlyChinese(text:string):boolean {
 const prose=text.replace(/\[GOTIT_(?:OPEN|CLOSE|KEEP)_\d+\]/g,'').replace(/(?:https?:\/\/|www\.|mailto:)[^\s<>]+/gi,'');
 // A dominant Chinese document may still contain a whole foreign paragraph.
 for(const line of prose.split(/\n+/)){const h=(line.match(/[\u3400-\u9fff]/g)??[]).length,l=(line.match(/\p{L}/gu)??[]).length;if(line.trim().length>=40&&l-h>=20&&h/Math.max(1,l)<.5)return false;}
 if([...prose.matchAll(/(?:[A-Za-z][A-Za-z'-]*\s+){5,}[A-Za-z][A-Za-z'-]*/g)].some(m=>m[0].replace(/\s/g,'').length>=35))return false;
 const nonLatin=(prose.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Greek}\p{Script=Hebrew}]/gu)??[]).length;if(nonLatin>=20)return false;
 const han=(prose.match(/[\u3400-\u9fff]/g)??[]).length,letters=(prose.match(/\p{L}/gu)??[]).length;
 if(han<40||!letters||han/letters<.85||/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]{4}/u.test(prose))return false;
 const common=new Set(['的','了','是','在','和','与','有','不','为','这','我','们','你','他','它','将','可','以','使','用','一','个','如','果','而','也','对','中']);
 return new Set([...prose].filter(c=>common.has(c))).size>=6;
}
