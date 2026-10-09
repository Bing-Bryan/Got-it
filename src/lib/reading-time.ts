// Product estimates for normal reading, not a measurement of comprehension time.
export function readingLoad(text: string) {
  const plain = text.replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, '');
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  const characters = plain.match(cjk)?.length ?? 0;
  const words = plain.replace(cjk, ' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return { minutes: characters / 400 + words / 200, characters: plain.match(/[\p{L}\p{N}]/gu)?.length ?? 0 };
}
export function readingMinutes(text: string): number | null {
  const { minutes } = readingLoad(text);
  return minutes > 0 ? Math.max(1, Math.ceil(minutes)) : null;
}
export function renderedReadingMinutes(html: string): number | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,img,.image-unavailable,[hidden]').forEach(node => node.remove());
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return readingMinutes(parts.join(' '));
}
