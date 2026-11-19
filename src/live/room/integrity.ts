/** Compares what the host heard of a guest during a take (the call copy, which the guest cannot touch) with the recording the guest handed over. */
export type Delivery = 'waiting' | 'receiving' | 'received' | 'short';

export interface DeliveryInput {
  /** Seconds the host's own copy of this guest's call audio lasted in this take */
  copySeconds: number;
  /** Seconds in the file the guest offered, or null when nothing has been offered yet */
  offeredSeconds: number | null;
  /** The file arrived in full and was accepted */
  done: boolean;
}

/** A file can be a little shorter than the call copy (the guest's recorder starts a moment after the call copy), so allow a small margin */
export const SHORT_MARGIN_SECONDS = 2;
export const SHORT_MARGIN_FRACTION = 0.05;

export function deliveryStatus(i: DeliveryInput): Delivery {
  if (i.offeredSeconds !== null && i.copySeconds >= 3) {
    const margin = Math.max(SHORT_MARGIN_SECONDS, i.copySeconds * SHORT_MARGIN_FRACTION);
    if (i.offeredSeconds < i.copySeconds - margin) return 'short';
  }
  if (i.done) return 'received';
  return i.offeredSeconds === null ? 'waiting' : 'receiving';
}

export const DELIVERY_TEXT: Record<Delivery, (guest: string) => string> = {
  waiting: (g) => `${g}'s full-quality recording has not arrived yet. Your call copy of ${g} is safe on this computer.`,
  receiving: (g) => `Receiving ${g}'s full-quality recording…`,
  received: (g) => `Full-quality recording from ${g} received and added to your project.`,
  short: (g) => `${g}'s recording is shorter than what you heard in the call. Part of it may be missing. Your call copy of ${g} is safe on this computer; compare the two.`,
};
