/** Which browser this is, and whether Uuda Studio runs at its best in it. Pure, so it can be tested without a browser. */

export interface BrowserInfo {
  name: string;
  /** Chrome, Brave, Edge and other Chromium browsers: everything works, including saving into your Uuda folder */
  best: boolean;
}

interface NavLike { userAgent: string; userAgentData?: { brands?: Array<{ brand: string }> }; brave?: unknown }

export const detectBrowser = (nav: NavLike): BrowserInfo => {
  const ua = nav.userAgent;
  const brands = (nav.userAgentData?.brands ?? []).map((b) => b.brand);
  const chromium = brands.includes('Chromium') || /\bChrome\/|\bChromium\/|\bEdg\/|\bOPR\//.test(ua);
  if (nav.brave) return { name: 'Brave', best: true };
  if (/\bEdg\//.test(ua)) return { name: 'Edge', best: true };
  if (/\bOPR\//.test(ua)) return { name: 'Opera', best: true };
  if (/\bVivaldi\//.test(ua)) return { name: 'Vivaldi', best: true };
  if (chromium && /\bChrome\//.test(ua)) return { name: 'Chrome', best: true };
  if (chromium) return { name: 'a Chromium browser', best: true };
  if (/\bFirefox\//.test(ua)) return { name: 'Firefox', best: false };
  if (/\bSafari\//.test(ua)) return { name: 'Safari', best: false };
  return { name: 'this browser', best: false };
};
