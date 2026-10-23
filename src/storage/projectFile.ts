import type { Asset, AssetKind, Project, VoiceMetadata } from '../types';

/**
 * UUDA project container v1, following the PRD's binary-container contract.
 * Layout: 6-byte `UUDAPJ` magic, uint32 LE UTF-8 manifest length, manifest JSON,
 * then raw Float32 PCM channel payloads. Channel offsets are relative to payload start.
 * The payload is intentionally uncompressed and dependency-free for exact sample round-trips.
 */
const MAGIC = new Uint8Array([0x55, 0x55, 0x44, 0x41, 0x50, 0x4a]); // UUDAPJ
const HEADER_BYTES = 10;
const CURRENT_FILE_VERSION = 1;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

interface ChannelDescriptor {
  byteOffset: number;
  byteLength: number;
}

interface ProjectAssetManifest {
  id: string;
  name: string;
  kind: AssetKind;
  sampleRate: number;
  durationSeconds: number;
  numberOfChannels: number;
  voiceMetadata?: VoiceMetadata;
  channels: ChannelDescriptor[];
}

interface ProjectFileManifest {
  app: string;
  version: number;
  savedAt: string;
  project: Project;
  assets: ProjectAssetManifest[];
}

export interface DecodedProjectFile {
  project: Project;
  assets: Asset[];
  missingAssetIds: string[];
  fileVersion: number;
}

function collectReferencedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const track of project.tracks || []) {
    for (const clip of track.clips || []) {
      if (clip.assetId) ids.add(clip.assetId);
      for (const version of clip.versionHistory || []) {
        if (version.assetId) ids.add(version.assetId);
      }
    }
  }
  return ids;
}

export function isUudaProjectFile(bytes: ArrayBuffer | Uint8Array): boolean {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.length >= MAGIC.length && MAGIC.every((byte, i) => view[i] === byte);
}

interface ProjectFileWritable {
  write(data: Uint8Array): Promise<void>;
}

/** Build metadata and zero-copy channel views shared by Blob and streaming writers. */
function buildProjectFileParts(
  project: Project,
  availableAssets: (id: string) => Asset | undefined
): { header: Uint8Array; manifestBytes: Uint8Array; audioParts: Uint8Array[]; totalBytes: number } {
  const referencedIds = collectReferencedAssetIds(project);
  const audioParts: Uint8Array[] = [];
  const assets: ProjectAssetManifest[] = [];
  let payloadOffset = 0;

  for (const id of referencedIds) {
    const asset = availableAssets(id);
    if (!asset?.buffer) {
      throw new Error(`Cannot save a self-contained UUDA project: referenced audio asset "${id}" is unavailable.`);
    }
    const channelDescriptors: ChannelDescriptor[] = [];
    for (let channelIndex = 0; channelIndex < asset.buffer.numberOfChannels; channelIndex++) {
      const samples = asset.buffer.getChannelData(channelIndex);
      const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
      channelDescriptors.push({ byteOffset: payloadOffset, byteLength: bytes.byteLength });
      audioParts.push(bytes);
      payloadOffset += bytes.byteLength;
    }
    assets.push({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      sampleRate: asset.sampleRate || asset.buffer.sampleRate,
      durationSeconds: asset.durationSeconds || asset.buffer.duration,
      numberOfChannels: asset.buffer.numberOfChannels,
      voiceMetadata: asset.voiceMetadata,
      channels: channelDescriptors,
    });
  }

  const manifest: ProjectFileManifest = {
    app: 'Uuda Studio',
    version: CURRENT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    project,
    assets,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('UUDA project manifest is unexpectedly large.');
  }
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint32(6, manifestBytes.byteLength, true);
  return { header, manifestBytes, audioParts, totalBytes: HEADER_BYTES + manifestBytes.byteLength + payloadOffset };
}

/** Creates a single-file project archive. Audio samples are stored exactly as float32 PCM. */
export function encodeProjectFile(project: Project, availableAssets: (id: string) => Asset | undefined): Blob {
  const parts = buildProjectFileParts(project, availableAssets);
  return new Blob([
    parts.header as BlobPart,
    parts.manifestBytes as BlobPart,
    ...parts.audioParts.map((part) => part as BlobPart),
  ], { type: 'application/vnd.uuda.project' });
}

/**
 * Writes a UUDA file in bounded chunks to a File System Access writable.
 * Unlike Blob construction, this avoids materializing one large project Blob in memory.
 * The writable is left open for the caller to close after successful completion.
 */
export async function writeProjectFileToWritable(
  project: Project,
  availableAssets: (id: string) => Asset | undefined,
  writable: ProjectFileWritable,
  onProgress?: (writtenBytes: number, totalBytes: number) => void,
  chunkBytes = 4 * 1024 * 1024
): Promise<void> {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < Float32Array.BYTES_PER_ELEMENT || chunkBytes % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Project write chunk size must be a positive Float32-aligned byte count.');
  }
  const parts = buildProjectFileParts(project, availableAssets);
  await writable.write(parts.header);
  await writable.write(parts.manifestBytes);
  let writtenBytes = HEADER_BYTES + parts.manifestBytes.byteLength;
  onProgress?.(writtenBytes, parts.totalBytes);
  for (const part of parts.audioParts) {
    for (let offset = 0; offset < part.byteLength; offset += chunkBytes) {
      const chunk = part.subarray(offset, Math.min(part.byteLength, offset + chunkBytes));
      await writable.write(chunk);
      writtenBytes += chunk.byteLength;
      onProgress?.(writtenBytes, parts.totalBytes);
      // Let the browser paint and service input between large writes.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  if (writtenBytes !== parts.totalBytes) {
    throw new Error(`UUDA write size mismatch: wrote ${writtenBytes} of ${parts.totalBytes} bytes.`);
  }
}

/** Reads UUDA v1 or legacy project JSON, reporting missing audio without crashing the project open. */
export async function decodeProjectFile(file: File, context: AudioContext): Promise<DecodedProjectFile> {
  // Inspect the header and manifest separately. Do not materialize a second full-file
  // ArrayBuffer for long audio projects; channel PCM is read in bounded chunks below.
  const headerBytes = await file.slice(0, HEADER_BYTES).arrayBuffer();
  if (!isUudaProjectFile(headerBytes)) {
    const parsed = JSON.parse(await file.text()) as Project;
    if (!parsed || !Array.isArray(parsed.tracks)) {
      throw new Error('Selected file is not a valid UUDA project or legacy JSON project.');
    }
    return { project: parsed, assets: [], missingAssetIds: [], fileVersion: 0 };
  }

  if (file.size < HEADER_BYTES) throw new Error('UUDA project file is truncated.');
  const headerView = new DataView(headerBytes);
  const manifestLength = headerView.getUint32(6, true);
  if (manifestLength === 0 || manifestLength > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestLength > file.size) {
    throw new Error('UUDA project manifest length is invalid.');
  }

  let manifest: ProjectFileManifest;
  try {
    const manifestBytes = await file.slice(HEADER_BYTES, HEADER_BYTES + manifestLength).arrayBuffer();
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ProjectFileManifest;
  } catch {
    throw new Error('UUDA project manifest is not valid JSON.');
  }
  if (!manifest.project || !Array.isArray(manifest.project.tracks) || !Array.isArray(manifest.assets)) {
    throw new Error('UUDA project manifest is missing project tracks or asset metadata.');
  }
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    throw new Error('UUDA project version is invalid.');
  }
  if (manifest.version > CURRENT_FILE_VERSION) {
    throw new Error(`This UUDA project uses file version ${manifest.version}, newer than this app supports (${CURRENT_FILE_VERSION}). Update Uuda Studio to open it.`);
  }

  const payloadStart = HEADER_BYTES + manifestLength;
  const payloadLength = file.size - payloadStart;
  const assets: Asset[] = [];
  const missingAssetIds = new Set<string>();
  const referencedIds = collectReferencedAssetIds(manifest.project);
  const seenAssetIds = new Set<string>();
  const COPY_CHUNK_BYTES = 4 * 1024 * 1024; // bounded temporary allocation (float32 aligned)

  for (const entry of manifest.assets) {
    if (!entry || typeof entry.id !== 'string' || seenAssetIds.has(entry.id)) continue;
    seenAssetIds.add(entry.id);
    const channels = Array.isArray(entry.channels) ? entry.channels : [];
    const expectedChannels = Math.max(1, Math.floor(entry.numberOfChannels || 1));
    const channelByteLength = channels[0]?.byteLength;
    const structurallyValid = channels.length === expectedChannels && typeof channelByteLength === 'number' &&
      Number.isSafeInteger(channelByteLength) && channelByteLength > 0 && channelByteLength % Float32Array.BYTES_PER_ELEMENT === 0 &&
      channels.every((channel) => Number.isSafeInteger(channel.byteOffset) && channel.byteOffset >= 0 &&
        Number.isSafeInteger(channel.byteLength) && channel.byteLength === channelByteLength &&
        channel.byteOffset + channel.byteLength <= payloadLength && channel.byteLength % Float32Array.BYTES_PER_ELEMENT === 0);
    if (!structurallyValid) {
      if (referencedIds.has(entry.id)) missingAssetIds.add(entry.id);
      continue;
    }

    try {
      const sampleRate = Math.floor(entry.sampleRate || 48000);
      if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 384000) {
        throw new Error('UUDA asset sample rate is invalid.');
      }
      const length = Math.max(1, channelByteLength / Float32Array.BYTES_PER_ELEMENT);
      const audioBuffer = context.createBuffer(expectedChannels, length, sampleRate);
      for (let channelIndex = 0; channelIndex < expectedChannels; channelIndex++) {
        const descriptor = channels[channelIndex];
        const destination = audioBuffer.getChannelData(channelIndex);
        for (let copiedFrames = 0; copiedFrames < length;) {
          const framesThisChunk = Math.min(length - copiedFrames, COPY_CHUNK_BYTES / Float32Array.BYTES_PER_ELEMENT);
          const start = payloadStart + descriptor.byteOffset + copiedFrames * Float32Array.BYTES_PER_ELEMENT;
          const end = start + framesThisChunk * Float32Array.BYTES_PER_ELEMENT;
          const chunkBytes = await file.slice(start, end).arrayBuffer();
          destination.set(new Float32Array(chunkBytes), copiedFrames);
          copiedFrames += framesThisChunk;
        }
      }
      assets.push({
        id: entry.id,
        name: entry.name || 'Recovered audio',
        kind: entry.kind || 'import',
        buffer: audioBuffer,
        sampleRate,
        durationSeconds: audioBuffer.duration,
        numberOfChannels: expectedChannels,
        voiceMetadata: entry.voiceMetadata,
      });
    } catch {
      if (referencedIds.has(entry.id)) missingAssetIds.add(entry.id);
    }
  }

  for (const id of referencedIds) if (!seenAssetIds.has(id)) missingAssetIds.add(id);
  return {
    project: manifest.project,
    assets,
    missingAssetIds: [...missingAssetIds],
    fileVersion: manifest.version,
  };
}
