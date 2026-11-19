import { describe, expect, it } from 'vitest';
import { isSheetHash, parseSheetHash, sheetLink } from './sheetLink';

describe('studio sheet link', () => {
  it('round-trips the answers and the name', () => {
    const url = sheetLink('https://uudastudio.goreallybig.com/', { goal: 'on-air', gear: 'analog-desk', hostOnAirViaMixer: true }, 'Main studio & desk');
    const hash = url.slice(url.indexOf('#'));
    expect(isSheetHash(hash)).toBe(true);
    expect(parseSheetHash(hash)).toEqual({ goal: 'on-air', gear: 'analog-desk', hostOnAirViaMixer: true, name: 'Main studio & desk' });
  });
  it('drops any old page address and keeps the name short', () => {
    const url = sheetLink('https://x.test/#/live/abc', { goal: 'podcast', gear: 'usb-mic', hostOnAirViaMixer: false }, 'n'.repeat(80));
    expect(url.startsWith('https://x.test/#/sheet?')).toBe(true);
    expect(parseSheetHash(url.slice(url.indexOf('#')))?.name).toHaveLength(40);
  });
  it('rejects links with unknown or missing answers', () => {
    expect(parseSheetHash('#/sheet?g=radio&e=toaster&a=1')).toBeNull();
    expect(parseSheetHash('#/sheet?g=radio&e=usb-mic')).toBeNull();
    expect(parseSheetHash('#/sheet?g=nope&e=usb-mic&a=1')).toBeNull();
    expect(parseSheetHash('#/sheet?g=radio&e=usb-mic&a=2')).toBeNull();
    expect(parseSheetHash('#/live/abc')).toBeNull();
    expect(parseSheetHash('')).toBeNull();
  });
});
