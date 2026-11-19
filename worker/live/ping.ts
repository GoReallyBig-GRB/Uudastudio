/** A tiny endpoint for the network check: it takes a small upload and says how much arrived. It stores nothing. */
export const PING_MAX_BYTES = 262_144;

export async function handlePing(request: Request, headers: Record<string, string> = {}): Promise<Response> {
  const h = { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: h });
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > PING_MAX_BYTES) return new Response(JSON.stringify({ error: 'Too large' }), { status: 413, headers: h });
  const body = await request.arrayBuffer();
  if (body.byteLength > PING_MAX_BYTES) return new Response(JSON.stringify({ error: 'Too large' }), { status: 413, headers: h });
  return new Response(JSON.stringify({ bytes: body.byteLength, now: Date.now() }), { status: 200, headers: h });
}
