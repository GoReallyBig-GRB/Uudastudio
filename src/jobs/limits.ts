import { ApiError } from './api';

export const DAILY_LIMIT_MESSAGE = 'The service has reached its daily limit. Your recording is safe on this device. Try again after 00:00 UTC, or save the file and send it yourself.';
export const STORAGE_FULL_MESSAGE = 'Storage is full. Your recording is safe on this device. Save the file and send it yourself.';

/** Map service limits to guidance that keeps local recordings available for manual delivery. */
export const limitErrorMessage = (error: unknown): string | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 507 || (error.status === 429 && /storage|space/i.test(error.message))) return STORAGE_FULL_MESSAGE;
  if (error.status === 429 && /thread is full/i.test(error.message)) return null;
  if (error.status === 429 || /\b1027\b/.test(error.message)) return DAILY_LIMIT_MESSAGE;
  return null;
};

export const apiErrorMessage = (error: unknown, fallback: string): string =>
  limitErrorMessage(error) ?? (error instanceof Error ? error.message : fallback);
