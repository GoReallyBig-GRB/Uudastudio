/**
 * MP3 frame parsing for chunked (streamed) import. Pure functions, no browser APIs, unit-tested.
 * Supports MPEG-1/2/2.5 Layer III, which is what .mp3 files contain.
 */
export interface Mp3FrameHeader {
  /** Total frame size in bytes, including the 4-byte header. */
  size: number;
  sampleRate: number;
  channels: number;
  /** PCM frames per MP3 frame (1152 for MPEG-1, 576 for MPEG-2/2.5). */
  samplesPerFrame: number;
  bitrate: number;
}

const BITRATE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Reads an MP3 frame header at `i`, or returns null if there is no valid Layer III header there. */
export function parseMp3Header(b: Uint8Array, i: number): Mp3FrameHeader | null {
  if (i + 4 > b.length) return null;
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  if (version === 1 || layer !== 1) return null;
  const bitrateIndex = b[i + 2] >> 4;
  const rateIndex = (b[i + 2] >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const padding = (b[i + 2] >> 1) & 1;
  const channels = ((b[i + 3] >> 6) & 3) === 3 ? 1 : 2;
  const bitrate = (version === 3 ? BITRATE_V1_L3 : BITRATE_V2_L3)[bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const samplesPerFrame = version === 3 ? 1152 : 576;
  const size = Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate) + padding;
  return { size, sampleRate, channels, samplesPerFrame, bitrate };
}

/** Number of bytes to skip at the start of the file for an ID3v2 tag (0 if there is none). `head` needs >= 10 bytes. */
export function id3v2TagLength(head: Uint8Array): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  return 10 + (((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127));
}

/** True for the Xing/Info/VBRI metadata frame some encoders put first. It carries no audio. */
export function isMp3MetadataFrame(frame: Uint8Array): boolean {
  const end = Math.min(frame.length, 64);
  for (let i = 4; i + 4 <= end; i++) {
    const a = frame[i], b = frame[i + 1], c = frame[i + 2], d = frame[i + 3];
    if ((a === 0x58 && b === 0x69 && c === 0x6e && d === 0x67) || // Xing
        (a === 0x49 && b === 0x6e && c === 0x66 && d === 0x6f) || // Info
        (a === 0x56 && b === 0x42 && c === 0x52 && d === 0x49)) { // VBRI
      return true;
    }
  }
  return false;
}

export interface Mp3FrameScan {
  /** [start, end) byte ranges of complete frames found in the buffer, in order. */
  frames: Array<{ start: number; header: Mp3FrameHeader }>;
  /** Index of the first unconsumed byte; keep data from here and prepend it to the next chunk. */
  consumed: number;
}

/**
 * Finds complete MP3 frames in `data`. A candidate header is only accepted if another valid header follows
 * at the expected position (or the data ends / `isFinalChunk`), which rejects false syncs inside audio data.
 */
export function scanMp3Frames(data: Uint8Array, isFinalChunk: boolean): Mp3FrameScan {
  const frames: Mp3FrameScan['frames'] = [];
  let i = 0;
  while (i + 4 <= data.length) {
    const header = parseMp3Header(data, i);
    if (!header) { i++; continue; }
    if (i + header.size > data.length) break; // incomplete frame: wait for more data
    if (i + header.size + 4 <= data.length && !parseMp3Header(data, i + header.size)) {
      // Next bytes are not a frame header: this is a false sync, unless we are at a tag/garbage boundary.
      i++;
      continue;
    }
    if (i + header.size + 4 > data.length && !isFinalChunk) break; // cannot verify yet
    frames.push({ start: i, header });
    i += header.size;
  }
  return { frames, consumed: i };
}
