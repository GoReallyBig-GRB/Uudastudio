import { describe, expect, it } from 'vitest';
import { isDevAuthBypassEnabled } from './authSecurity';
describe('development auth bypass', () => {
 it('is disabled by default', () => { expect(isDevAuthBypassEnabled('development', undefined)).toBe(false); expect(isDevAuthBypassEnabled('test', undefined)).toBe(false); });
 it('requires an explicit flag outside production', () => { expect(isDevAuthBypassEnabled('development', 'true')).toBe(true); expect(isDevAuthBypassEnabled('development', 'false')).toBe(false); });
 it('cannot be enabled in production', () => { expect(isDevAuthBypassEnabled('production', 'true')).toBe(false); });
});
