
/**
 * A ticket lets one admitted guest upload one take of one event. The room hands it to the guest over its live connection;
 * nobody can make one without the server secret. It carries its own expiry.
 */
export const TICKET_LIFETIME_MS = 8 * 24 * 3600_000;

async function mac(secret: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const TAKE_ID = /^take-\d{1,4}-[A-Za-z0-9]{1,16}$/;

export async function makeTicket(secret: string, eventId: string, takeId: string, now: number): Promise<string> {
  const exp = now + TICKET_LIFETIME_MS;
  return `${exp}.${await mac(secret, `drop|${eventId}|${takeId}|${exp}`)}`;
}

export async function checkTicket(secret: string, eventId: string, takeId: string, ticket: string, now: number): Promise<boolean> {
  const m = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(ticket);
  if (!m || !TAKE_ID.test(takeId)) return false;
  const exp = Number(m[1]);
  if (exp < now) return false;
  const want = await mac(secret, `drop|${eventId}|${takeId}|${exp}`);
  let d = 0;
  for (let i = 0; i < 64; i++) d |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return d === 0;
}
