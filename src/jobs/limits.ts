/**
 * What the jobs pages say when the free service is full. Cloudflare's free plan stops answering
 * after its daily request cap (a 429 that is not our JSON, or error 1027) and our own server
 * answers 507 when the audio storage is full. Neither may lose the person's recording.
 */
export type LimitKind = 'daily' | 'storage';

export const DAILY_LIMIT_MESSAGE = 'The service has reached its daily limit. Your recording is safe on this device. Try again after 00:00 UTC, or save the file and send it yourself.';
export const STORAGE_FULL_FALLBACK = 'The service has no room for more audio right now. Your recording is safe on this device. Save the file and send it yourself, or try again later.';

/**
 * `serverMessage` is the `error` text of a JSON answer from our own server, if there was one.
 * Our server uses 429 for "this thread is full", which is not the daily limit, so a 429 only counts
 * when it carries no message of ours (Cloudflare's own refusal).
 */
export const limitKind = (status: number, serverMessage?: string): LimitKind | null => {
  if (status === 507) return 'storage';
  if ((status === 429 || status === 503 || status === 1027) && !serverMessage) return 'daily';
  return null;
};

/** The message to show, or null when the error is not about a limit */
export const limitMessage = (status: number, serverMessage?: string): string | null => {
  const kind = limitKind(status, serverMessage);
  if (kind === 'daily') return DAILY_LIMIT_MESSAGE;
  if (kind === 'storage') return serverMessage || STORAGE_FULL_FALLBACK;
  return null;
};
