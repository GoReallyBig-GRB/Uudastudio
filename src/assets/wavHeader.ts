/**
 * WAV header parsing and PCM-to-float conversion for chunked (streamed) import. Pure functions, unit-tested.
 */
export interface WavInfo {
  format: 'pcm' | 'float';
  bitsPerSample: number;
  channels: number;
  sampleRate: number;
  /** Byte offset of the first audio sample in the file. */
  dataOffset: number;
  /** Length of the audio data in bytes (clamped to what the file really contains). */
  dataBytes: number;
  frames: number;
  bytesPerFrame: number;
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/** Parses a RIFF/WAVE header from the start of a file. `head` should hold at least the first few KB. */
export function parseWavHeader(head: Uint8Array, fileSize: number): WavInfo | null {
  if (head.length < 12 || ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 4) !== 'WAVE') return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let pos = 12;
  let fmt: { tag: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (pos + 8 <= head.length) {
    const id = ascii(head, pos, 4);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ' && body + 16 <= head.length) {
      let tag = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (tag === 0xfffe && size >= 26 && body + 26 <= head.length) tag = view.getUint16(body + 24, true); // extensible: sub-format
      fmt = { tag, channels, sampleRate, bits };
    } else if (id === 'data') {
      if (!fmt) return null;
      const format = fmt.tag === 3 ? 'float' : fmt.tag === 1 ? 'pcm' : null;
      if (!format || fmt.channels < 1 || !(fmt.bits === 8 || fmt.bits === 16 || fmt.bits === 24 || fmt.bits === 32)) return null;
      if (format === 'float' && fmt.bits !== 32) return null;
      const bytesPerFrame = fmt.channels * (fmt.bits / 8);
      // Streams and some editors write 0 or 0xFFFFFFFF as the size: use whatever the file contains.
      const available = Math.max(0, fileSize - body);
      let dataBytes = size === 0 || size === 0xffffffff || size > available ? available : size;
      dataBytes -= dataBytes % bytesPerFrame;
      return { format, bitsPerSample: fmt.bits, channels: fmt.channels, sampleRate: fmt.sampleRate, dataOffset: body, dataBytes, frames: dataBytes / bytesPerFrame, bytesPerFrame };
    }
    pos = body + size + (size % 2);
  }
  return null;
}

/** Converts interleaved integer/float PCM bytes into planar float32 channels (values in -1..1). */
export function pcmToPlanar(bytes: Uint8Array, info: Pick<WavInfo, 'format' | 'bitsPerSample' | 'channels'>, frames: number, out: Float32Array[]): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { channels, bitsPerSample: bits, format } = info;
  let p = 0;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      let v: number;
      if (format === 'float') { v = view.getFloat32(p, true); p += 4; }
      else if (bits === 16) { v = view.getInt16(p, true) / 32768; p += 2; }
      else if (bits === 24) { v = ((view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16))) / 8388608; p += 3; }
      else if (bits === 32) { v = view.getInt32(p, true) / 2147483648; p += 4; }
      else { v = (view.getUint8(p) - 128) / 128; p += 1; }
      out[c][f] = v;
    }
  }
}
