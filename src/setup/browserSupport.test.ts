import { describe, expect, it } from 'vitest';
import { detectBrowser } from './browserSupport';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
describe('browser support', () => {
  it('names Chrome, Edge, Brave and Opera as best', () => {
    expect(detectBrowser({ userAgent: CHROME })).toEqual({ name: 'Chrome', best: true });
    expect(detectBrowser({ userAgent: `${CHROME} Edg/130.0.0.0` })).toEqual({ name: 'Edge', best: true });
    expect(detectBrowser({ userAgent: CHROME, brave: {} })).toEqual({ name: 'Brave', best: true });
    expect(detectBrowser({ userAgent: `${CHROME} OPR/115.0.0.0` })).toEqual({ name: 'Opera', best: true });
  });
  it('treats any other Chromium browser as best', () => {
    expect(detectBrowser({ userAgent: 'Mozilla/5.0 X11 AppleWebKit/537.36', userAgentData: { brands: [{ brand: 'Chromium' }] } }).best).toBe(true);
  });
  it('says Firefox and Safari work but not at their best', () => {
    expect(detectBrowser({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0' })).toEqual({ name: 'Firefox', best: false });
    expect(detectBrowser({ userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' })).toEqual({ name: 'Safari', best: false });
  });
});
