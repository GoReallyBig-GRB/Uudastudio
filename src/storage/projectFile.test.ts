import { describe, expect, it } from 'vitest';
import type { Asset, Project } from '../types';
import { decodeProjectFile, encodeProjectFile, isUudaProjectFile } from './projectFile';

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
      expect(Array.from(decoded.assets[0].buffer.getChannelData(channel))).toEqual(Array.from(originalChannels[channel]));
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
});
