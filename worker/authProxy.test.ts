import { describe, expect, it } from 'vitest';
import { authProxyTarget } from './authProxy';

describe('Firebase sign-in on our own address', () => {
  it('passes the Firebase sign-in paths to the project host, keeping the query', () => {
    expect(authProxyTarget(new URL('https://uudatest.goreallybig.com/__/auth/handler?apiKey=x&mode=signIn'), 'my-proj-123')?.toString())
      .toBe('https://my-proj-123.firebaseapp.com/__/auth/handler?apiKey=x&mode=signIn');
    expect(authProxyTarget(new URL('https://a.b/__/firebase/init.json'), 'my-proj-123')?.host).toBe('my-proj-123.firebaseapp.com');
  });
  it('refuses everything else', () => {
    expect(authProxyTarget(new URL('https://a.b/api/auth/session'), 'my-proj-123')).toBeNull();
    expect(authProxyTarget(new URL('https://a.b/__/auth/handler'), undefined)).toBeNull();
    expect(authProxyTarget(new URL('https://a.b/__/auth/handler'), 'evil.com/x')).toBeNull();
  });
});
