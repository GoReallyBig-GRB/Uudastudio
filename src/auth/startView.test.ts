import { describe, expect, it } from 'vitest';
import { MAX_AUTH_WAIT_MS, startView } from './startView';

const base = { checking: false, signedIn: false, guest: false, waitedMs: 0 };

describe('startView', () => {
  it('waits while the saved login is being checked, without showing the sign-in page', () => {
    expect(startView({ ...base, checking: true })).toBe('wait');
  });
  it('opens the studio for someone who is signed in, whether or not the check has finished', () => {
    expect(startView({ ...base, signedIn: true })).toBe('studio');
    expect(startView({ ...base, checking: true, signedIn: true })).toBe('studio');
  });
  it('shows the sign-in page only once the check is done and nobody is signed in', () => {
    expect(startView(base)).toBe('auth');
  });
  it('lets a guest straight in', () => {
    expect(startView({ ...base, guest: true })).toBe('studio');
    expect(startView({ ...base, checking: true, guest: true })).toBe('studio');
  });
  it('stops waiting after the limit, so a slow or offline check does not leave a blank page', () => {
    expect(startView({ ...base, checking: true, waitedMs: MAX_AUTH_WAIT_MS - 1 })).toBe('wait');
    expect(startView({ ...base, checking: true, waitedMs: MAX_AUTH_WAIT_MS })).toBe('auth');
  });
});
