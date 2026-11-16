import { describe, expect, it } from 'vitest';
import { withOrigin } from './pageMeta';

describe('link preview tags', () => {
  it('fills in the address the page was served from', () => {
    const out = withOrigin('<meta property="og:image" content="__ORIGIN__/og-image.jpg" /><meta property="og:url" content="__ORIGIN__/" />', 'https://uudatest.goreallybig.com/');
    expect(out).toBe('<meta property="og:image" content="https://uudatest.goreallybig.com/og-image.jpg" /><meta property="og:url" content="https://uudatest.goreallybig.com/" />');
  });
});
