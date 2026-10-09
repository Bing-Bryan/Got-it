import { describe, expect, it } from 'vitest';
import { readingMinutes, renderedReadingMinutes } from './reading-time';
import { renderMarkdown } from './markdown';

describe('reading time', () => {
  it('adds Chinese characters and English words before rounding', () => {
    expect(readingMinutes('中'.repeat(400))).toBe(1);
    expect(readingMinutes('word '.repeat(201))).toBe(2);
    expect(readingMinutes('中'.repeat(200) + ' word'.repeat(100))).toBe(1);
    expect(readingMinutes('短文')).toBe(1);
  });
  it('omits empty and non-reading content', () => {
    expect(readingMinutes(' \n --- !!!')).toBeNull();
    expect(readingMinutes('https://example.org/' + 'x'.repeat(1000))).toBeNull();
  });
  it('counts visible Markdown, excluding markup, destinations and image notices', () => {
    const source = '# ' + '中'.repeat(400) + '\n\n[文](https://example.org/' + 'x'.repeat(10000) + ')\n\n![图片](missing.png)';
    expect(renderedReadingMinutes(renderMarkdown(source).html)).toBe(2);
    expect(renderedReadingMinutes(renderMarkdown('![图片](missing.png)').html)).toBeNull();
    expect(renderedReadingMinutes('<p>' + 'word '.repeat(200) + '</p><p>next</p>')).toBe(2);
  });
});
