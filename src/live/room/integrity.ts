/** Compares what the host heard of a guest during a take (the call copy, which the guest cannot touch) with the recording the guest handed over. */
export type Delivery = 'waiting' | 'held' | 'receiving' | 'received' | 'short' | 'gaps';

export interface DeliveryInput {
  /** Seconds the host's own copy of this guest's call audio lasted in this take */
  copySeconds: number;
  /** Seconds in the file the guest offered, or null when nothing has been offered yet */
  offeredSeconds: number | null;
  /** The file arrived in full and was accepted */
  done: boolean;
  /** The guest is connected through the shared relay, so the big file waits for a direct connection */
  relayed?: boolean;
  /** Result of comparing the file with what the host heard: false means stretches are missing */
  complete?: boolean;
}

/** A file can be a little shorter than the call copy (the guest's recorder starts a moment after the call copy), so allow a small margin */
export const SHORT_MARGIN_SECONDS = 2;
export const SHORT_MARGIN_FRACTION = 0.05;

export function deliveryStatus(i: DeliveryInput): Delivery {
  if (i.offeredSeconds !== null && i.copySeconds >= 3) {
    const margin = Math.max(SHORT_MARGIN_SECONDS, i.copySeconds * SHORT_MARGIN_FRACTION);
    if (i.offeredSeconds < i.copySeconds - margin) return 'short';
  }
  if (i.done && i.complete === false) return 'gaps';
  if (i.done) return 'received';
  if (i.offeredSeconds === null) return i.relayed ? 'held' : 'waiting';
  return 'receiving';
}

export const DELIVERY_TEXT: Record<Delivery, (guest: string) => string> = {
  waiting: (g) => `${g}'s full-quality recording has not arrived yet. ${g}'s voice is in your session backup.`,
  held: (g) => `${g} is connected through the shared relay, so the full-quality recording is held to protect the free relay allowance. It sends when a direct connection is possible. ${g}'s voice is in your session backup.`,
  receiving: (g) => `Receiving ${g}'s full-quality recording…`,
  received: (g) => `Full-quality recording from ${g} received and added to your project.`,
  short: (g) => `${g}'s recording is shorter than what you heard in the call. Part of it may be missing. ${g}'s voice is in your session backup; compare the two.`,
  gaps: (g) => `${g}'s recording is missing stretches that you heard in the call. ${g}'s voice is in your session backup; compare the two.`,
};

import type { ActivityMatch } from './activity';
import { MIN_CONFIDENCE } from './activity';

/**
 * Says so when the guest's file looks out of line with what the host heard.
 * The host hears a guest a little late (the call's delay), so a small difference is normal; only a large one is worth saying.
 */
export function alignmentNote(m: ActivityMatch | null, expectedOffsetMs: number, guest: string): string | null {
  if (!m || m.confidence < MIN_CONFIDENCE) return null;
  const off = m.offsetMs - expectedOffsetMs;
  if (Math.abs(off) > 1500) return `${guest}'s recording may be out of line with yours by about ${(Math.abs(off) / 1000).toFixed(1)} seconds. Check it before editing.`;
  if (m.driftPpm !== null && Math.abs(m.driftPpm) > 1500) return `${guest}'s recording slowly drifts against yours over the take. Check the end of it before editing.`;
  return null;
}
