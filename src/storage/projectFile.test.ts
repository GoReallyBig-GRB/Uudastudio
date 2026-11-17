import { describe, expect, it } from 'vitest';
import type { Asset, Project } from '../types';
import { decodeProjectFile, encodeProjectFile, encodeProjectFileAsync, isUudaProjectFile, writeProjectFileToWritable, type StreamedHooks } from './projectFile';

function fakeAudioBuffer(channelData: Float32Array[], sampleRate = 48000): AudioBuffer {
  const length = channelData[0]?.length || 0;
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channelData.length,
    getChannelData: (index: number) => channelData[index],
  } as unknown as AudioBuffer;
}

function fakeContext(): AudioContext {
  return {
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const channelData = Array.from({ length: channels }, () => new Float32Array(length));
      return fakeAudioBuffer(channelData, sampleRate);
    },
  } as unknown as AudioContext;
}

const project: Project = {
  id: 'project-test',
  name: 'Round trip',
  sampleRate: 48000,
  settings: { autoRefresh: true, sampleRate: 48000, duckPlayingTracks: true, duckingAmountDb: -12 },
  tracks: [{
    id: 'track-1', name: 'Voice', volume: 1, pan: 0, muted: false, solo: false,
    clips: [{
      id: 'clip-1', trackId: 'track-1', assetId: 'asset-1', name: 'Voice', startSeconds: 0,
      offsetSeconds: 0, durationSeconds: 4 / 48000, gain: 1, fadeInSeconds: 0,
      fadeOutSeconds: 0, fadeShape: 'linear',
      versionHistory: [{ id: 'version-1', name: 'Previous', assetId: 'asset-1', timestamp: 1, operation: 'test' }],
    }],
  }],
};

const originalChannels = [
  new Float32Array([0, 0.25, -0.5, 1]),
  new Float32Array([1, 0.5, -0.25, 0]),
];
const originalAsset: Asset = {
  id: 'asset-1', name: 'voice.wav', kind: 'import', buffer: fakeAudioBuffer(originalChannels),
  sampleRate: 48000, durationSeconds: 4 / 48000, numberOfChannels: 2,
};

describe('UUDA project file', () => {
  it('round-trips project metadata and exact float32 samples in all channels', async () => {
    const blob = encodeProjectFile(project, (id) => id === originalAsset.id ? originalAsset : undefined);
    const file = new File([blob as BlobPart], 'round-trip.uuda');
    expect(isUudaProjectFile(await file.arrayBuffer())).toBe(true);

    const decoded = await decodeProjectFile(file, fakeContext());
    expect(decoded.fileVersion).toBe(1);
    expect(decoded.project).toEqual(project);
    expect(decoded.missingAssetIds).toEqual([]);
    expect(decoded.assets).toHaveLength(1);
    for (let channel = 0; channel < originalChannels.length; channel++) {
      expect(Array.from(decoded.assets[0].buffer!.getChannelData(channel))).toEqual(Array.from(originalChannels[channel]));
    }
  });

  it('rejects a newer file version rather than opening it as if supported', async () => {
    const blob = encodeProjectFile(project, (id) => id === originalAsset.id ? originalAsset : undefined);
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    const manifestLength = view.getUint32(6, true);
    const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 10, manifestLength)));
    manifest.version = 99;
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const header = new Uint8Array(10);
    header.set(new Uint8Array(bytes, 0, 6));
    new DataView(header.buffer).setUint32(6, manifestBytes.length, true);
    const payloadStart = 10 + manifestLength;
    const newerFile = new File([header as BlobPart, manifestBytes as BlobPart, new Uint8Array(bytes, payloadStart) as BlobPart], 'future.uuda');
    await expect(decodeProjectFile(newerFile, fakeContext())).rejects.toThrow(/newer than this app supports/);
  });

  it('reports referenced assets missing from a valid manifest without crashing', async () => {
    const blob = encodeProjectFile(project, (id) => id === originalAsset.id ? originalAsset : undefined);
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    const manifestLength = view.getUint32(6, true);
    const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 10, manifestLength)));
    manifest.assets = [];
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const header = new Uint8Array(10);
    header.set(new Uint8Array(bytes, 0, 6));
    new DataView(header.buffer).setUint32(6, manifestBytes.length, true);
    const missingFile = new File([header as BlobPart, manifestBytes as BlobPart], 'missing.uuda');
    const decoded = await decodeProjectFile(missingFile, fakeContext());
    expect(decoded.project.id).toBe(project.id);
    expect(decoded.missingAssetIds).toEqual(['asset-1']);
  });

  it('reports a referenced audio asset as missing when its PCM payload is truncated', async () => {
    const blob = encodeProjectFile(project, (id) => id === originalAsset.id ? originalAsset : undefined);
    const bytes = await blob.arrayBuffer();
    const truncatedFile = new File([bytes.slice(0, bytes.byteLength - 4)], 'truncated.uuda');
    const decoded = await decodeProjectFile(truncatedFile, fakeContext());

    expect(decoded.project.id).toBe(project.id);
    expect(decoded.assets).toHaveLength(0);
    expect(decoded.missingAssetIds).toEqual(['asset-1']);
  });

  it('rejects a malformed manifest length instead of reading outside the file', async () => {
    const header = new Uint8Array([0x55, 0x55, 0x44, 0x41, 0x50, 0x4a, 0xff, 0xff, 0xff, 0x7f]);
    const file = new File([header as BlobPart], 'bad-manifest.uuda');
    await expect(decodeProjectFile(file, fakeContext())).rejects.toThrow(/manifest length is invalid/);
  });

  describe('long (streamed) audio', () => {
    const store = new Map<string, Float32Array[]>([['long-1', [
      Float32Array.from({ length: 10 }, (_, i) => i / 10),
      Float32Array.from({ length: 10 }, (_, i) => -i / 10),
    ]]]);
    const restored = new Map<string, Float32Array[][]>();
    const hooks: StreamedHooks = {
      available: () => true,
      readChannel: async (id, c, start, frames) => (store.get(id)?.[c] ?? new Float32Array(0)).slice(start, start + frames),
      createWriter: async (id, _sr, ch) => {
        const blocks: Float32Array[][] = [];
        restored.set(id, blocks);
        return {
          write: async (chunk) => { blocks.push(chunk); },
          finish: async () => ({ frames: blocks.reduce((n, b) => n + b[0].length, 0), peakBase: 256 }),
          abort: async () => { restored.delete(id); },
        };
      },
    };
    const longAsset: Asset = {
      id: 'long-1', name: 'long.wav', kind: 'import', source: { storeId: 'long-1', frames: 10, peakBaseSamplesPerPixel: 256 },
      sampleRate: 48000, durationSeconds: 10 / 48000, numberOfChannels: 2,
    };
    const longProject: Project = {
      ...project,
      tracks: [{ ...project.tracks[0], clips: [{ ...project.tracks[0].clips[0], assetId: 'long-1', versionHistory: [] }] }],
    };
    const lookup = (id: string) => id === 'long-1' ? longAsset : undefined;

    it('refuses the in-memory encoder for long audio but writes it in small pieces to a file', async () => {
      expect(() => encodeProjectFile(longProject, lookup)).toThrow(/long audio/);
      const written: Uint8Array[] = [];
      await writeProjectFileToWritable(longProject, lookup, { write: async (d) => { written.push(d.slice()); } }, undefined, 16, hooks);
      expect(written.length).toBeGreaterThan(4); // 16-byte pieces, not one block
      const file = new File(written as BlobPart[], 'long.uuda');
      const decoded = await decodeProjectFile(file, fakeContext(), hooks);
      expect(decoded.missingAssetIds).toEqual([]);
      expect(decoded.assets[0].source?.frames).toBe(10);
      expect(decoded.assets[0].buffer).toBeUndefined();
      const back = restored.get('long-1')!.flatMap((b) => Array.from(b[1]));
      expect(back).toEqual(Array.from(store.get('long-1')![1]));
    });

    it('builds the same file as a Blob for browsers that download', async () => {
      const blob = await encodeProjectFileAsync(longProject, lookup, undefined, hooks, 16);
      const decoded = await decodeProjectFile(new File([blob as BlobPart], 'long.uuda'), fakeContext(), hooks);
      expect(decoded.assets[0].source?.storeId).toBe('long-1');
    });

    it('stops with a clear message if the stored audio cannot be read back', async () => {
      const broken: StreamedHooks = { ...hooks, readChannel: async () => new Float32Array(0) };
      await expect(writeProjectFileToWritable(longProject, lookup, { write: async () => {} }, undefined, 16, broken)).rejects.toThrow(/could not be read back/);
    });
  });
});
