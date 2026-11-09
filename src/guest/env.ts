/** What the talent's browser can do, so the page can warn before a recording is lost. Pure, unit-tested. */

/** Browsers built into other apps (WhatsApp, Instagram and so on) often block the microphone or lose recordings */
export const isInAppBrowser = (userAgent: string): boolean => /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|MicroMessenger|TikTok|musical_ly|Snapchat|Line\/|Twitter|LinkedInApp|GSA\/|; wv\)/i.test(userAgent);

export const isIPhone = (userAgent: string): boolean => /iPhone|iPad|iPod/i.test(userAgent);

export interface Capability {
  ok: boolean;
  /** Plain-language reason when not ok */
  problem?: string;
}

export const checkRecording = (env: { userAgent: string; hasMediaDevices: boolean; isSecureContext: boolean; hasAudioContext: boolean }): Capability => {
  if (isInAppBrowser(env.userAgent)) return { ok: false, problem: 'This link was opened inside another app, which often blocks the microphone. Open it in Chrome (Android) or Safari (iPhone) instead: use the menu in the corner and choose "Open in browser".' };
  if (!env.isSecureContext) return { ok: false, problem: 'The microphone only works on a secure (https) address. Ask the producer to check the link.' };
  if (!env.hasMediaDevices || !env.hasAudioContext) return { ok: false, problem: 'This browser cannot record from a microphone. Try Chrome or Safari.' };
  return { ok: true };
};
