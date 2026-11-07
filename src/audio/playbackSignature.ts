import type { Track } from '../types';

/**
 * Everything about the clips that is fixed when playback is scheduled: which clips, which audio and where, muting and fades.
 * Gain is left out on purpose: it is applied live without restarting playback (see AudioEngine.syncClipGains).
 */
export const playbackSignature = (tracks: Track[]): string =>
  tracks
    .map((t) =>
      t.id + ':' + t.clips
        .map((c) => `${c.id}|${c.assetId}|${c.startSeconds}|${c.offsetSeconds}|${c.durationSeconds}|${c.muted ? 1 : 0}|${c.fadeInSeconds}|${c.fadeOutSeconds}|${c.fadeShape}|${c.groupId ?? ''}`)
        .join(','),
    )
    .join(';');
