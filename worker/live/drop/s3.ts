/** Signs requests to an S3-compatible store (Backblaze B2) with AWS Signature Version 4, using only Web Crypto so it runs in a Worker. */

export interface S3Config { endpoint: string; bucket: string; region: string; keyId: string; appKey: string }

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array): string => [...new Uint8Array(b instanceof Uint8Array ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer : b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async (data: string | Uint8Array): Promise<string> => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)));
async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const raw = key instanceof Uint8Array ? (key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer) : key;
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}

const rfc3986 = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (p: string): string => p.split('/').map(rfc3986).join('/');
const stamp = (d: Date): { amz: string; day: string } => { const iso = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); return { amz: iso, day: iso.slice(0, 8) }; };

export interface SignInput {
  method: string;
  host: string;
  /** Path as it will be requested, not yet encoded, starting with / */
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body, or UNSIGNED-PAYLOAD */
  payloadHash: string;
  region: string;
  keyId: string;
  appKey: string;
  now: Date;
}

/** Returns the headers to send, including Authorization */
export async function signRequest(i: SignInput): Promise<Record<string, string>> {
  const { amz, day } = stamp(i.now);
  const headers: Record<string, string> = { ...Object.fromEntries(Object.entries(i.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])), host: i.host, 'x-amz-content-sha256': i.payloadHash, 'x-amz-date': amz };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const q = Object.entries(i.query ?? {}).map(([k, v]) => [rfc3986(k), rfc3986(v)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const canonical = [i.method, encodePath(i.path), q.map(([k, v]) => `${k}=${v}`).join('&'), canonicalHeaders, signedHeaders, i.payloadHash].join('\n');
  const scope = `${day}/${i.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, await sha256Hex(canonical)].join('\n');
  const kDate = await hmac(enc.encode(`AWS4${i.appKey}`), day);
  const kRegion = await hmac(kDate, i.region);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, toSign));
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${i.keyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}` };
}
