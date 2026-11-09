/** Links for voice-talent jobs kept on the server. The job id and key sit after the # sign, so they are not sent to the page host. */

export const TALENT_PREFIX = '#/t/';
const ID = /^[0-9a-f]{32}$/;
const KEY = /^[0-9a-f]{32,128}$/;

export const talentLink = (base: string, jobId: string, key: string): string => `${base.replace(/#.*$/, '')}${TALENT_PREFIX}${jobId}.${key}`;

export const parseTalentHash = (hash: string): { jobId: string; key: string } | null => {
  if (!hash.startsWith(TALENT_PREFIX)) return null;
  const [jobId, key] = hash.slice(TALENT_PREFIX.length).split('.');
  return ID.test(jobId ?? '') && KEY.test(key ?? '') ? { jobId, key } : null;
};

export const isTalentHash = (hash: string): boolean => hash.startsWith(TALENT_PREFIX);

/** A ready-to-paste message the producer can send with the link */
export const inviteText = (title: string, producer: string, link: string): string =>
  `Hi, here is the script for "${title}"${producer ? ` from ${producer}` : ''}. Open the link on your phone or computer, record your take and press Send. You can message me on the same page.\n${link}`;

export const nudgeText = (title: string, link: string): string => `I replied on "${title}". Open your link to read it:\n${link}`;
