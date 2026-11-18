import { describe, expect, it } from 'vitest';
import { CALL_BITRATE, isPolite, micConstraints, planConnections, qualityOf, tuneOpus } from './callPlan';
import type { RoomPeer } from './roomState';

const peer = (id: string, admitted = true): RoomPeer => ({ id, role: 'guest', name: id, admitted, muted: false, recording: false });

describe('who connects to whom', () => {
  it('connects to everyone admitted and drops people who left or are not admitted', () => {
    expect(planConnections('me', [peer('a'), peer('b', false), peer('c')], true, ['c', 'x'])).toEqual({ connect: ['a'], drop: ['x'] });
  });
  it('connects to nobody while waiting to be let in', () => {
    expect(planConnections('me', [peer('a')], false, ['a'])).toEqual({ connect: [], drop: ['a'] });
  });
  it('never connects to itself', () => { expect(planConnections('me', [peer('me')], true, []).connect).toEqual([]); });
  it('makes exactly one side polite', () => { expect(isPolite('a', 'b')).toBe(true); expect(isPolite('b', 'a')).toBe(false); });
});

describe('connection quality', () => {
  it('grades by round trip, loss and jitter', () => {
    expect(qualityOf({ rttMs: 60, lossPct: 0, relayed: false, jitterMs: 5 })).toBe('good');
    expect(qualityOf({ rttMs: 300, lossPct: 0, relayed: false, jitterMs: 5 })).toBe('weak');
    expect(qualityOf({ rttMs: 60, lossPct: 3, relayed: true, jitterMs: 5 })).toBe('weak');
    expect(qualityOf({ rttMs: 60, lossPct: 9, relayed: false, jitterMs: 5 })).toBe('poor');
    expect(qualityOf({ rttMs: null, lossPct: null, relayed: false, jitterMs: null })).toBe('unknown');
  });
});

describe('audio settings', () => {
  const sdp = ['m=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=0', 'a=rtpmap:63 red/48000/2', 'a=fmtp:63 111/111'].join('\r\n');
  it('turns on error recovery, mono and 20 ms packets for Opus only', () => {
    const out = tuneOpus(sdp);
    expect(out).toMatch(/a=fmtp:111 [^\r\n]*useinbandfec=1/);
    expect(out).toMatch(/a=fmtp:111 [^\r\n]*stereo=0/);
    expect(out).toMatch(/a=fmtp:111 [^\r\n]*minptime=20/);
    expect(out).toMatch(/maxaveragebitrate=48000/);
    expect(out).toContain('a=fmtp:63 111/111'); // other codecs untouched
  });
});

describe('broadcast connections and settings', () => {
  const host: RoomPeer = { ...peer('h'), role: 'producer' };
  it('a guest in a broadcast connects to the host only; the host connects to every guest', () => {
    expect(planConnections('g1', [host, peer('g2'), peer('g1')], true, [], 'broadcast', 'guest')).toEqual({ connect: ['h'], drop: [] });
    expect(planConnections('g1', [host, peer('g2')], true, ['g2'], 'broadcast', 'guest')).toEqual({ connect: ['h'], drop: ['g2'] });
    expect(planConnections('h', [peer('g1'), peer('g2')], true, [], 'broadcast', 'producer').connect).toEqual(['g1', 'g2']);
  });
  it('a conversation still connects everyone to everyone', () => {
    expect(planConnections('g1', [host, peer('g2')], true, [], 'conversation', 'guest').connect).toEqual(['h', 'g2']);
  });
  it('turns the microphone clean-up off for a broadcast guest with headphones, keeps echo cancelling without them', () => {
    expect(micConstraints('broadcast', true)).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(micConstraints('broadcast', false)).toMatchObject({ echoCancellation: true, noiseSuppression: false, autoGainControl: false });
    expect(micConstraints('conversation', true)).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  });
  it('uses the broadcast bit rate', () => {
    const sdp = ['a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10'].join('\r\n');
    expect(tuneOpus(sdp, CALL_BITRATE.broadcast)).toContain('maxaveragebitrate=64000');
  });
});
