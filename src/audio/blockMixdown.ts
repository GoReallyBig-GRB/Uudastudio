/**
 * Mixdown of a project in blocks, so a 3-hour mix never has to exist as one buffer.
 *
 * Each block is rendered in its own OfflineAudioContext from the same graph the live engine uses (clip gain and fades,
 * track volume, pan, effect plugins, ducking, master bus and fader) and handed to a callback as planar float32.
 * Everything memoryless (gain, pan, fades) is exact across block joins. Effects with memory (plugins, reverb tails) start
 * each block a few seconds early and discard that lead-in, so their state has settled by the time the block begins.
 *
 * Long (streamed) assets are read from storage one window at a time, and only the part a block needs.
 * `renderProjectOffline` (mastering.ts) is this same code collected into one AudioBuffer for short projects.
 */
import type { Asset, Clip, Project } from '../types';
import { buildDuckCurve, scheduleDuckCurve, normalizeDucking } from './ducking';
import { groupChainId, groupIdsOf } from '../plugins/groupChain';
import { groupOutputGain, groupPan, groupSettingsFor } from './groupSettings';

export interface SkippedPluginInfo {
  chainId: string;
  name: string;
  reason: 'missing' | 'failed';
}

export interface MixdownDeps {
  getAsset(assetId: string): Asset | undefined;
  /** 0 when the master is muted */
  masterFaderGain: number;
  /** Wires the active plugins of a chain after `source`; returns the last node. */
  appendPlugins(ctx: OfflineAudioContext, chainId: string, source: AudioNode, skipped: SkippedPluginInfo[]): Promise<AudioNode>;
  /** True if the chain has at least one active plugin (decides whether a lead-in is needed). */
  chainHasPlugins(chainId: string): boolean;
  masterChainId: string;
  /** Planar float32 frames [startFrame, startFrame + frames) of a streamed asset. */
  readFrames(asset: Asset, startFrame: number, frames: number): Promise<Float32Array[]>;
}

export interface MixdownOptions {
  range?: { startSeconds: number; endSeconds: number };
  blockSeconds?: number;
  /** Seconds each block starts early so plugin state can settle. Used only when a chain has plugins. */
  leadInSeconds?: number;
  onProgress?: (fraction: number) => void;
  isCancelled?: () => boolean;
}

export interface MixdownPlan {
  rangeStart: number;
  rangeEnd: number;
  totalFrames: number;
  sampleRate: number;
}

export function planMixdown(project: Project, sampleRate: number, range?: { startSeconds: number; endSeconds: number }): MixdownPlan {
  let maxEnd = 1.0;
  for (const t of project.tracks) for (const c of t.clips) maxEnd = Math.max(maxEnd, c.startSeconds + c.durationSeconds);
  const rangeStart = range ? Math.max(0, range.startSeconds) : 0;
  const rangeEnd = range ? Math.min(maxEnd, range.endSeconds) : maxEnd;
  const duration = Math.max(0.5, rangeEnd - rangeStart);
  return { rangeStart, rangeEnd, totalFrames: Math.max(sampleRate, Math.ceil(duration * sampleRate)), sampleRate };
}

/** Throws if a ducked track follows streamed audio: its level curve cannot be built from storage yet. */
function assertDuckingCanBeBuilt(project: Project, deps: MixdownDeps): void {
  for (const track of project.tracks) {
    if (track.muted) continue;
    const settings = normalizeDucking(track.ducking);
    if (!settings.enabled || settings.sourceTrackIds.length === 0) continue;
    for (const src of project.tracks) {
      if (src.id === track.id || !settings.sourceTrackIds.includes(src.id) || src.muted) continue;
      for (const clip of src.clips) {
        if (clip.muted) continue;
        const a = deps.getAsset(clip.assetId);
        if (a?.source && !a.buffer) {
          throw new Error(`"${track.name}" is set to duck under "${src.name}", which contains long streamed audio. Ducking from long audio is not available yet; turn ducking off for this export.`);
        }
      }
    }
  }
}

/** Gain breakpoints of a clip in absolute project time: fade-in ramp up, hold, fade-out ramp down. */
function clipBreakpoints(clip: Clip, base: number): Array<[number, number]> {
  const start = clip.startSeconds;
  const end = start + clip.durationSeconds;
  const pts: Array<[number, number]> = [];
  if (clip.fadeInSeconds > 0) { pts.push([start, 0]); pts.push([start + clip.fadeInSeconds, base]); } else pts.push([start, base]);
  if (clip.fadeOutSeconds > 0) { pts.push([Math.max(start, end - clip.fadeOutSeconds), base]); pts.push([end, 0]); } else pts.push([end, base]);
  pts.sort((a, b) => a[0] - b[0]);
  return pts;
}

function valueAt(pts: Array<[number, number]>, t: number): number {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [t1, v1] = pts[i];
    const [t0, v0] = pts[i - 1];
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return pts[pts.length - 1][1];
}

/**
 * Renders project time [windowStart, windowEnd) into a 2-channel buffer of `frames` frames.
 * Block joins are exact for clip gain and fades because the fade ramps are evaluated in project time, not from the
 * (possibly cut) window.
 */
async function renderWindow(
  project: Project,
  deps: MixdownDeps,
  sampleRate: number,
  windowStart: number,
  frames: number,
  duckCurves: Map<string, Float32Array | null>,
  skipped: SkippedPluginInfo[],
): Promise<AudioBuffer> {
  const windowEnd = windowStart + frames / sampleRate;
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const hasSolo = project.tracks.some((t) => t.solo);

  const masterNode = ctx.createGain();
  masterNode.gain.setValueAtTime(deps.masterFaderGain, 0);
  masterNode.connect(ctx.destination);
  const masterBusIn = ctx.createGain();
  const masterBusOut = await deps.appendPlugins(ctx, deps.masterChainId, masterBusIn, skipped);
  masterBusOut.connect(masterNode);

  // Group buses: the clips of a group are summed here (they ignore their track's fader, pan and mute/solo), then the group's
  // chain runs once, then the group's own level and pan are applied. Same order as the live engine.
  const groupBuses = new Map<string, GainNode>();
  const getGroupBus = async (groupId: string): Promise<GainNode> => {
    let bus = groupBuses.get(groupId);
    if (!bus) {
      bus = ctx.createGain();
      const out = await deps.appendPlugins(ctx, groupChainId(groupId), bus, skipped);
      const settings = groupSettingsFor(project, groupId);
      const level = ctx.createGain();
      level.gain.setValueAtTime(groupOutputGain(settings), 0);
      out.connect(level);
      const pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(groupPan(settings), 0);
      level.connect(pan);
      pan.connect(masterBusIn);
      groupBuses.set(groupId, bus);
    }
    return bus;
  };

  for (const track of project.tracks) {
    // Grouped clips ignore their track's mute and solo (the group has its own channel); loose clips follow them.
    const trackAudible = !track.muted && !(hasSolo && !track.solo);
    const clips = track.clips.filter((c) => !c.muted && c.durationSeconds > 0
      && c.startSeconds + c.durationSeconds > windowStart && c.startSeconds < windowEnd
      && (c.groupId || trackAudible));
    if (clips.length === 0) continue;

    let trackGain: GainNode | null = null;
    if (trackAudible) {
      trackGain = ctx.createGain();
      trackGain.gain.setValueAtTime(track.volume, 0);
      const trackPan = ctx.createStereoPanner();
      trackPan.pan.setValueAtTime(track.pan, 0);
      trackGain.connect(trackPan);
      const trackOutput = await deps.appendPlugins(ctx, track.id, trackPan, skipped);

      const duck = duckCurves.get(track.id);
      if (duck) {
        const duckNode = ctx.createGain();
        scheduleDuckCurve(duckNode.gain, duck, windowStart, 0);
        trackOutput.connect(duckNode);
        duckNode.connect(masterBusIn);
      } else {
        trackOutput.connect(masterBusIn);
      }
    }

    for (const clip of clips) {
      const asset = deps.getAsset(clip.assetId);
      if (!asset || (!asset.buffer && !asset.source)) continue;
      const clipEnd = clip.startSeconds + clip.durationSeconds;
      const playFrom = Math.max(clip.startSeconds, windowStart); // project time where this clip starts sounding in the window
      const playTo = Math.min(clipEnd, windowEnd);
      if (playTo <= playFrom) continue;
      const renderStart = playFrom - windowStart;
      const playDuration = playTo - playFrom;
      const sourceOffset = (clip.offsetSeconds || 0) + (playFrom - clip.startSeconds);

      const source = ctx.createBufferSource();
      if (asset.buffer) {
        source.buffer = asset.buffer;
      } else {
        const sr = asset.sampleRate;
        const first = Math.max(0, Math.floor(sourceOffset * sr));
        const count = Math.max(1, Math.min(Math.ceil(playDuration * sr) + 2, asset.source!.frames - first));
        const data = await deps.readFrames(asset, first, count);
        const got = data.length === 0 ? 0 : Math.min(count, ...data.map((d) => d.length));
        if (got <= 0) continue;
        const buf = ctx.createBuffer(Math.max(1, asset.numberOfChannels), got, sr);
        for (let c = 0; c < buf.numberOfChannels; c++) {
          buf.copyToChannel(data[Math.min(c, data.length - 1)].subarray(0, got) as Float32Array<ArrayBuffer>, c);
        }
        source.buffer = buf;
      }

      const clipGain = ctx.createGain();
      const base = clip.gain ?? 1.0;
      const pts = clipBreakpoints(clip, base);
      clipGain.gain.setValueAtTime(valueAt(pts, playFrom), renderStart);
      for (const [t, v] of pts) {
        if (t <= playFrom) continue;
        clipGain.gain.linearRampToValueAtTime(v, t - windowStart);
        if (t >= playTo) break; // ramp continues past the window edge, so the slope inside it is right
      }
      source.connect(clipGain);
      clipGain.connect(clip.groupId ? await getGroupBus(clip.groupId) : trackGain!);

      if (asset.buffer) {
        source.start(renderStart, sourceOffset, playDuration);
      } else {
        const sr = asset.sampleRate;
        const first = Math.max(0, Math.floor(sourceOffset * sr));
        source.start(renderStart, Math.max(0, sourceOffset - first / sr), playDuration);
      }
    }
  }
  return ctx.startRendering();
}

/**
 * Renders the whole range block by block. `onBlock` receives planar float32 for exactly `frames` frames starting at
 * `startFrame` (frames since the range start); the arrays are only valid during the call.
 */
export async function mixdownInBlocks(
  project: Project,
  deps: MixdownDeps,
  sampleRate: number,
  options: MixdownOptions,
  onBlock: (channels: Float32Array[], startFrame: number, frames: number) => void | Promise<void>,
): Promise<{ plan: MixdownPlan; skippedPlugins: SkippedPluginInfo[] }> {
  const plan = planMixdown(project, sampleRate, options.range);
  assertDuckingCanBeBuilt(project, deps);

  const blockFrames = Math.max(sampleRate, Math.round((options.blockSeconds ?? 60) * sampleRate));
  const usesPlugins = deps.chainHasPlugins(deps.masterChainId)
    || project.tracks.some((t) => deps.chainHasPlugins(t.id))
    || groupIdsOf(project).some((g) => deps.chainHasPlugins(groupChainId(g)));
  const leadInFrames = usesPlugins ? Math.round((options.leadInSeconds ?? 4) * sampleRate) : 0;
  const skipped: SkippedPluginInfo[] = [];

  // Ducking curves cover the whole project; build each once, not once per block
  const duckCurves = new Map<string, Float32Array | null>();
  const getChannels = (id: string) => {
    const b = deps.getAsset(id)?.buffer;
    if (!b) return null;
    const channels: Float32Array[] = [];
    for (let c = 0; c < b.numberOfChannels; c++) channels.push(b.getChannelData(c));
    return { channels, sampleRate: b.sampleRate };
  };
  for (const track of project.tracks) duckCurves.set(track.id, buildDuckCurve(project, track, getChannels));

  for (let start = 0; start < plan.totalFrames; start += blockFrames) {
    if (options.isCancelled?.()) throw new Error('Export cancelled.');
    const frames = Math.min(blockFrames, plan.totalFrames - start);
    const lead = Math.min(leadInFrames, start);
    const windowStart = plan.rangeStart + (start - lead) / sampleRate;
    const seen: SkippedPluginInfo[] = [];
    const rendered = await renderWindow(project, deps, sampleRate, windowStart, lead + frames, duckCurves, seen);
    for (const s of seen) if (!skipped.some((k) => k.chainId === s.chainId && k.name === s.name && k.reason === s.reason)) skipped.push(s);
    const channels = [0, 1].map((c) => rendered.getChannelData(c).subarray(lead, lead + frames));
    await onBlock(channels, start, frames);
    options.onProgress?.(Math.min(1, (start + frames) / plan.totalFrames));
    // Let the page paint and respond between blocks
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return { plan, skippedPlugins: skipped };
}

