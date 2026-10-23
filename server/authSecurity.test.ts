import { describe, expect, it } from 'vitest';
import { isDevAuthBypassEnabled } from './authSecurity';

describe('development auth bypass', () => {
  it('is disabled by default, including in non-production environments', () => {
    expect(isDevAuthBypassEnabled('development', undefined)).toBe(false);
    expect(isDevAuthBypassEnabled('test', undefined)).toBe(false);
    expect(isDevAuthBypassEnabled(undefined, undefined)).toBe(false);
  });

  it('requires an explicit flag outside production', () => {
    expect(isDevAuthBypassEnabled('development', 'true')).toBe(true);
    expect(isDevAuthBypassEnabled('test', 'true')).toBe(true);
    expect(isDevAuthBypassEnabled('development', 'false')).toBe(false);
  });

  it('cannot be enabled in production, even with the flag set', () => {
    expect(isDevAuthBypassEnabled('production', 'true')).toBe(false);
  });
});
