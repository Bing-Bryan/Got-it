import {expect,it} from 'vitest';
import {REGION_MAX_PIXELS,REGION_MAX_SCALE,regionNeedsSmallerSelection,regionScale} from './pdf-region';
it('renders small regions at the maximum scale and caps pixels for large ones',()=>{
  expect(regionScale([66,335,544,480])).toBe(REGION_MAX_SCALE);expect(regionNeedsSmallerSelection([66,335,544,480])).toBe(false);
  const page=regionScale([0,0,612,792]);expect(page).toBeLessThan(3);expect(612*792*page*page).toBeLessThanOrEqual(REGION_MAX_PIXELS+1);
  expect(regionNeedsSmallerSelection([0,0,612,792])).toBe(true);
  expect(regionScale([10,10,10,40])).toBe(0);
});
