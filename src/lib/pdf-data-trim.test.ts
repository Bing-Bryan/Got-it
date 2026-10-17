import {expect,it} from 'vitest';
import {trimToBytes} from './pdf-data';
it('trims text to a UTF-8 byte budget without splitting characters',()=>{
  expect(trimToBytes('abc',10)).toBe('abc');
  const zh=trimToBytes('最大逻辑值'.repeat(400),3000);expect(new TextEncoder().encode(zh).length).toBeLessThanOrEqual(3000);expect(zh.length).toBe(1000);
  expect(trimToBytes('a😀b',3)).toBe('a');
});
