import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, sendAudio } from './api';
import { apiErrorMessage, DAILY_LIMIT_MESSAGE, limitErrorMessage, STORAGE_FULL_MESSAGE } from './limits';

afterEach(() => vi.unstubAllGlobals());

describe('limit error messages', () => {
  it('gives the exact daily limit guidance for 429 responses and Cloudflare 1027', () => {
    expect(limitErrorMessage(new ApiError(429, 'Something went wrong. Try again.'))).toBe(DAILY_LIMIT_MESSAGE);
    expect(limitErrorMessage(new ApiError(503, 'Cloudflare error 1027'))).toBe(DAILY_LIMIT_MESSAGE);
    expect(DAILY_LIMIT_MESSAGE).toBe('The service has reached its daily limit. Your recording is safe on this device. Try again after 00:00 UTC, or save the file and send it yourself.');
  });

  it('explains storage capacity errors while keeping the local file available', () => {
    expect(limitErrorMessage(new ApiError(507, 'Insufficient storage'))).toBe(STORAGE_FULL_MESSAGE);
    expect(limitErrorMessage(new ApiError(429, 'Storage limit reached'))).toBe(STORAGE_FULL_MESSAGE);
  });

  it('leaves unrelated errors untouched', () => {
    const e = new ApiError(404, 'The jobs service is not available here.');
    expect(limitErrorMessage(e)).toBeNull();
    expect(apiErrorMessage(e, 'fallback')).toBe(e.message);
    expect(apiErrorMessage(new ApiError(429, 'This thread is full.'), 'fallback')).toBe('This thread is full.');
    expect(apiErrorMessage(new Error('offline'), 'fallback')).toBe('offline');
  });

  it.each([429, 507])('maps a fake upload server response with HTTP %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: status === 507 ? 'Storage is full.' : 'Daily request limit reached.' }), { status })));
    const take = new Blob(['local take'], { type: 'audio/wav' });
    let caught: unknown;
    try { await sendAudio('job', 'key', take, { name: 'take.wav', who: 'Talent' }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ApiError);
    expect(limitErrorMessage(caught)).toBe(status === 507 ? STORAGE_FULL_MESSAGE : DAILY_LIMIT_MESSAGE);
  });
});
