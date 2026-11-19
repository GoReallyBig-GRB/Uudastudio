import { describe, expect, it } from 'vitest';
import { sha256Hex, signRequest } from './s3';

describe('S3 request signing', () => {
  // The worked example in Amazon's Signature Version 4 documentation (GET Object with a Range header)
  it('matches the published example', async () => {
    const h = await signRequest({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', region: 'us-east-1',
      keyId: 'AKIAIOSFODNN7EXAMPLE', appKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(h['x-amz-date']).toBe('20130524T000000Z');
  });
  it('hashes the empty body', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('signs query strings in order and encodes keys with odd characters', async () => {
    const a = await signRequest({ method: 'PUT', host: 'h.test', path: '/b/live/a b.bin', query: { partNumber: '2', uploadId: 'x y' }, payloadHash: 'UNSIGNED-PAYLOAD', region: 'r', keyId: 'k', appKey: 's', now: new Date('2026-01-01T00:00:00Z') });
    const b = await signRequest({ method: 'PUT', host: 'h.test', path: '/b/live/a b.bin', query: { uploadId: 'x y', partNumber: '2' }, payloadHash: 'UNSIGNED-PAYLOAD', region: 'r', keyId: 'k', appKey: 's', now: new Date('2026-01-01T00:00:00Z') });
    expect(a.authorization).toBe(b.authorization);
    const c = await signRequest({ method: 'PUT', host: 'h.test', path: '/b/live/a b.bin', query: { partNumber: '3', uploadId: 'x y' }, payloadHash: 'UNSIGNED-PAYLOAD', region: 'r', keyId: 'k', appKey: 's', now: new Date('2026-01-01T00:00:00Z') });
    expect(c.authorization).not.toBe(a.authorization);
  });
});
