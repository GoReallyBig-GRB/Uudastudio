import { describe, expect, it } from 'vitest';
import { PING_MAX_BYTES, handlePing } from './ping';

describe('network check endpoint', () => {
  it('reports how many bytes arrived', async () => {
    const res = await handlePing(new Request('https://x.test/api/live/ping', { method: 'POST', body: new Uint8Array(1000) }));
    expect(res.status).toBe(200);
    expect((await res.json() as { bytes: number }).bytes).toBe(1000);
  });
  it('refuses anything but POST, and anything too large', async () => {
    expect((await handlePing(new Request('https://x.test/api/live/ping'))).status).toBe(405);
    const big = await handlePing(new Request('https://x.test/api/live/ping', { method: 'POST', body: new Uint8Array(PING_MAX_BYTES + 1) }));
    expect(big.status).toBe(413);
  });
});
