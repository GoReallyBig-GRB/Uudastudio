export function measureLoudness(buffer: AudioBuffer): LoudnessStats {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;

  if (length === 0) {
    return { integratedLUFS: -70, truePeakDbTP: -70, rmsDb: -70, loudnessRangeLU: 0, durationSeconds: 0 };
  }

  let maxTruePeakLinear = 0;
  let totalSumSq = 0;
  const channelData: Float32Array[] = [];

  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    channelData.push(data);
    const tp = calculateTruePeak(data);
    if (tp > maxTruePeakLinear) maxTruePeakLinear = tp;
    for (let i = 0; i < length; i++) totalSumSq += data[i] * data[i];
  }

  const rms = Math.sqrt(totalSumSq / (length * numChannels || 1));
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -70;
  const truePeakDbTP = maxTruePeakLinear > 0 ? 20 * Math.log10(maxTruePeakLinear) : -70;

  // K-Weighting Biquad Coefficients (ITU-R BS.1770-4 for 48kHz; normalized).
  const a1_hs = -1.69065929318241;
  const a2_hs = 0.73248077421585;
  const b0_hs = 1.53512485958697;
  const b1_hs = -2.69169618940638;
  const b2_hs = 1.19839281085285;
  const a1_hp = -1.99004745483398;
  const a2_hp = 0.99007225036621;
  const b0_hp = 1.0;
  const b1_hp = -2.0;
  const b2_hp = 1.0;

  // Retain only one 400 ms ring buffer per channel and one power value per 100 ms
  // block. Avoid allocating a second full-length Float32Array for every channel.
  const blockSize = Math.floor(0.4 * sampleRate);
  const hopSize = Math.floor(0.1 * sampleRate);
  const effectiveBlockSize = Math.max(1, Math.min(blockSize, length));
  const effectiveHopSize = Math.max(1, Math.min(hopSize, effectiveBlockSize));
  const numBlocks = Math.max(1, Math.ceil(Math.max(0, length - effectiveBlockSize) / effectiveHopSize) + 1);
  const channelBlockPowers: Float64Array[] = [];

  for (let c = 0; c < numChannels; c++) {
    const input = channelData[c];
    const blockPowers = new Float64Array(numBlocks);
    const squareRing = new Float64Array(effectiveBlockSize);
    let rollingSum = 0;

    let x1_hs = 0, x2_hs = 0, y1_hs = 0, y2_hs = 0;
    let x1_hp = 0, x2_hp = 0, y1_hp = 0, y2_hp = 0;

    for (let i = 0; i < length; i++) {
      const x = input[i];
      const y_hs = b0_hs * x + b1_hs * x1_hs + b2_hs * x2_hs - a1_hs * y1_hs - a2_hs * y2_hs;
      x2_hs = x1_hs;
      x1_hs = x;
      y2_hs = y1_hs;
      y1_hs = y_hs;

      const y_hp = b0_hp * y_hs + b1_hp * x1_hp + b2_hp * x2_hp - a1_hp * y1_hp - a2_hp * y2_hp;
      x2_hp = x1_hp;
      x1_hp = y_hs;
      y2_hp = y1_hp;
      y1_hp = y_hp;

      const ringIndex = i % effectiveBlockSize;
      const squared = y_hp * y_hp;
      if (i >= effectiveBlockSize) rollingSum -= squareRing[ringIndex];
      squareRing[ringIndex] = squared;
      rollingSum += squared;

      if (i + 1 >= effectiveBlockSize) {
        const start = i + 1 - effectiveBlockSize;
        if (start % effectiveHopSize === 0) {
          const blockIndex = start / effectiveHopSize;
          if (blockIndex < numBlocks) blockPowers[blockIndex] = rollingSum / effectiveBlockSize;
        }
      }
    }

    channelBlockPowers.push(blockPowers);
  }

  const blockPowers: number[] = [];
  const shortTermPowers: number[] = [];
  for (let b = 0; b < numBlocks; b++) {
    let blockSum = 0;
    for (let c = 0; c < numChannels; c++) blockSum += channelBlockPowers[c][b];
    const blockLoudness = -0.691 + 10 * Math.log10(Math.max(1e-12, blockSum));
    if (blockLoudness > -70) {
      blockPowers.push(blockSum);
      shortTermPowers.push(blockLoudness);
    }
  }

  let integratedLUFS = -70;
  if (blockPowers.length > 0) {
    const avgPower = blockPowers.reduce((a, b) => a + b, 0) / blockPowers.length;
    const gammaA = -0.691 + 10 * Math.log10(Math.max(1e-12, avgPower)) - 10;
    const gatedPowers = blockPowers.filter((p) => {
      const lkfs = -0.691 + 10 * Math.log10(Math.max(1e-12, p));
      return lkfs > gammaA;
    });
    if (gatedPowers.length > 0) {
      const finalPower = gatedPowers.reduce((a, b) => a + b, 0) / gatedPowers.length;
      integratedLUFS = -0.691 + 10 * Math.log10(Math.max(1e-12, finalPower));
    } else {
      integratedLUFS = -0.691 + 10 * Math.log10(Math.max(1e-12, avgPower));
    }
  } else {
    integratedLUFS = Math.max(-70, rmsDb - 3.0);
  }

  let loudnessRangeLU = 0;
  if (shortTermPowers.length >= 10) {
    const sorted = [...shortTermPowers].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    loudnessRangeLU = Math.max(0, Math.round((p95 - p10) * 10) / 10);
  }

  return {
    integratedLUFS: Math.round(integratedLUFS * 10) / 10,
    truePeakDbTP: Math.round(truePeakDbTP * 10) / 10,
    rmsDb: Math.round(rmsDb * 10) / 10,
    loudnessRangeLU,
    durationSeconds: Math.round((length / sampleRate) * 10) / 10,
  };
}


export async function measureLoudnessAsync(buffer: AudioBuffer, onProgress?: (progress: ExportProgress) => void, progressStart = 60, progressEnd = 70): Promise<LoudnessStats> {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;

  if (length === 0) {
    return { integratedLUFS: -70, truePeakDbTP: -70, rmsDb: -70, loudnessRangeLU: 0, durationSeconds: 0 };
  }

  const channelData: Float32Array[] = [];
  let maxTruePeakLinear = 0;
  let totalSumSq = 0;

  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    channelData.push(data);
    const tp = await calculateTruePeakAsync(data);
    if (tp > maxTruePeakLinear) maxTruePeakLinear = tp;

    for (let i = 0; i < length; i++) {
      if ((i + 1) % 262144 === 0) {
        const ratio = (c * length + i + 1) / Math.max(1, length * numChannels);
        onProgress?.({ stage: 'mastering', percent: Math.round(progressStart + (0.2 + ratio * 0.2) * (progressEnd - progressStart)), message: 'Analyzing loudness in yielding blocks...' });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      totalSumSq += data[i] * data[i];
    }
  }

  const rms = Math.sqrt(totalSumSq / (length * numChannels || 1));
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -70;
  const truePeakDbTP = maxTruePeakLinear > 0 ? 20 * Math.log10(maxTruePeakLinear) : -70;

  // K-Weighting Biquad Coefficients (ITU-R BS.1770-4 for 48kHz; normalized)
  const a1_hs = -1.69065929318241;
  const a2_hs = 0.73248077421585;
  const b0_hs = 1.53512485958697;
  const b1_hs = -2.69169618940638;
  const b2_hs = 1.19839281085285;

  const a1_hp = -1.99004745483398;
  const a2_hp = 0.99007225036621;
  const b0_hp = 1.0;
  const b1_hp = -2.0;
  const b2_hp = 1.0;

  const blockSize = Math.floor(0.4 * sampleRate);
  const hopSize = Math.floor(0.1 * sampleRate);
  const effectiveBlockSize = Math.max(1, Math.min(blockSize, length));
  const effectiveHopSize = Math.max(1, Math.min(hopSize, effectiveBlockSize));
  const numBlocks = Math.max(1, Math.ceil(Math.max(0, length - effectiveBlockSize) / effectiveHopSize) + 1);
  const blockPowers = new Array<number>(numBlocks).fill(0);
  const shortTermPowers: number[] = [];
  const activeBlockPowers: number[] = [];

  for (let c = 0; c < numChannels; c++) {
    const input = channelData[c];
    const ring = new Float32Array(effectiveBlockSize);
    let ringIndex = 0;
    let ringSum = 0;
    let x1_hs = 0, x2_hs = 0, y1_hs = 0, y2_hs = 0;
    let x1_hp = 0, x2_hp = 0, y1_hp = 0, y2_hp = 0;

    for (let i = 0; i < length; i++) {
      const x = input[i];
      const y_hs = b0_hs * x + b1_hs * x1_hs + b2_hs * x2_hs - a1_hs * y1_hs - a2_hs * y2_hs;
      x2_hs = x1_hs;
      x1_hs = x;
      y2_hs = y1_hs;
      y1_hs = y_hs;

      const y_hp = b0_hp * y_hs + b1_hp * x1_hp + b2_hp * x2_hp - a1_hp * y1_hp - a2_hp * y2_hp;
      x2_hp = x1_hp;
      x1_hp = y_hs;
      y2_hp = y1_hp;
      y1_hp = y_hp;

      const square = y_hp * y_hp;
      if (i < effectiveBlockSize) {
        ring[ringIndex] = y_hp;
        ringSum += square;
      } else {
        const outgoing = ring[ringIndex];
        ringSum -= outgoing * outgoing;
        ring[ringIndex] = y_hp;
        ringSum += square;
      }
      ringIndex = (ringIndex + 1) % ring.length;

      const windowStart = i - effectiveBlockSize + 1;
      if (windowStart >= 0 && windowStart % effectiveHopSize === 0) {
        const blockIndex = windowStart / effectiveHopSize;
        if (blockIndex >= 0 && blockIndex < blockPowers.length) {
          blockPowers[blockIndex] += ringSum / effectiveBlockSize;
        }
      }

      if ((i + 1) % 262144 === 0) {
        const ratio = (c * length + i + 1) / Math.max(1, length * numChannels);
        onProgress?.({
          stage: 'mastering',
          percent: Math.round(progressStart + (0.4 + ratio * 0.3) * (progressEnd - progressStart)),
          message: 'Filtering audio in bounded memory blocks...'
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  for (let b = 0; b < blockPowers.length; b++) {
    if (b > 0 && b % 64 === 0) {
      const ratio = b / Math.max(1, blockPowers.length);
      onProgress?.({
        stage: 'mastering',
        percent: Math.round(progressStart + (0.7 + ratio * 0.3) * (progressEnd - progressStart)),
        message: 'Applying loudness gating...'
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const blockSum = blockPowers[b];
    const blockLoudness = -0.691 + 10 * Math.log10(Math.max(1e-12, blockSum));
    if (blockLoudness > -70) {
      activeBlockPowers.push(blockSum);
      shortTermPowers.push(blockLoudness);
    }
  }

  let integratedLUFS = -70;

  if (activeBlockPowers.length > 0) {
    const avgPower = activeBlockPowers.reduce((a, b) => a + b, 0) / activeBlockPowers.length;
    const gammaA = -0.691 + 10 * Math.log10(Math.max(1e-12, avgPower)) - 10;

    const gatedPowers = activeBlockPowers.filter((p) => {
      const lkfs = -0.691 + 10 * Math.log10(Math.max(1e-12, p));
      return lkfs > gammaA;
    });

    if (gatedPowers.length > 0) {
      const finalPower = gatedPowers.reduce((a, b) => a + b, 0) / gatedPowers.length;
      integratedLUFS = -0.691 + 10 * Math.log10(Math.max(1e-12, finalPower));
    } else {
      integratedLUFS = -0.691 + 10 * Math.log10(Math.max(1e-12, avgPower));
    }
  } else {
    integratedLUFS = Math.max(-70, rmsDb - 3.0);
  }

  let loudnessRangeLU = 0;
  if (shortTermPowers.length >= 10) {
    const sorted = [...shortTermPowers].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    loudnessRangeLU = Math.max(0, Math.round((p95 - p10) * 10) / 10);
  }

  return {
    integratedLUFS: Math.round(integratedLUFS * 10) / 10,
    truePeakDbTP: Math.round(truePeakDbTP * 10) / 10,
    rmsDb: Math.round(rmsDb * 10) / 10,
    loudnessRangeLU,
    durationSeconds: Math.round((length / sampleRate) * 10) / 10,
  };
}
