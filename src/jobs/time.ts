/** "just now", "5 min ago", "3 h ago", "yesterday", then the date */
export const ago = (ts: number, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86400) return 'yesterday';
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
};
