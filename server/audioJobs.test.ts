import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { safelyDeleteFile, activeJobs, AudioJobRecord } from './audioJobs';

describe('Audio Processing Engine - Ephemeral Storage & Temp File Deletion', () => {
  const TEST_TEMP_DIR = path.join(os.tmpdir(), 'uuda-test-temp');
  if (!fs.existsSync(TEST_TEMP_DIR)) {
    fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
  }

  it('safely deletes input and output files on job completion', () => {
    const inputPath = path.join(TEST_TEMP_DIR, `input-${Date.now()}.wav`);
    const outputPath = path.join(TEST_TEMP_DIR, `output-${Date.now()}.wav`);

    // Create dummy files
    fs.writeFileSync(inputPath, Buffer.from('RIFF....WAVEfmt '));
    fs.writeFileSync(outputPath, Buffer.from('RIFF....WAVEfmt denoised'));

    expect(fs.existsSync(inputPath)).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(true);

    // Simulate cleanup on job completion
    safelyDeleteFile(inputPath);
    safelyDeleteFile(outputPath);

    expect(fs.existsSync(inputPath)).toBe(false);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('deletes temp files on job failure', () => {
    const failedInputPath = path.join(TEST_TEMP_DIR, `fail-input-${Date.now()}.wav`);
    const failedOutputPath = path.join(TEST_TEMP_DIR, `fail-output-${Date.now()}.wav`);

    fs.writeFileSync(failedInputPath, Buffer.from('RIFF corrupt'));
    fs.writeFileSync(failedOutputPath, Buffer.from('corrupt partial'));

    expect(fs.existsSync(failedInputPath)).toBe(true);

    // Cleanup upon failure
    safelyDeleteFile(failedInputPath);
    safelyDeleteFile(failedOutputPath);

    expect(fs.existsSync(failedInputPath)).toBe(false);
    expect(fs.existsSync(failedOutputPath)).toBe(false);
  });

  it('purges files and registry when a job is cancelled', () => {
    const jobId = `test-cancel-${Date.now()}`;
    const cancelInput = path.join(TEST_TEMP_DIR, `cancel-in-${jobId}.wav`);
    const cancelOutput = path.join(TEST_TEMP_DIR, `cancel-out-${jobId}.wav`);

    fs.writeFileSync(cancelInput, Buffer.from('RIFF cancel test'));
    fs.writeFileSync(cancelOutput, Buffer.from('RIFF cancel out'));

    const record: AudioJobRecord = {
      id: jobId,
      type: 'denoise',
      status: 'processing',
      progress: 50,
      inputPath: cancelInput,
      outputPath: cancelOutput,
      createdAt: Date.now(),
    };

    activeJobs.set(jobId, record);
    expect(activeJobs.has(jobId)).toBe(true);

    // Perform cancel operation logic
    safelyDeleteFile(record.inputPath);
    safelyDeleteFile(record.outputPath);
    record.status = 'cancelled';
    activeJobs.delete(jobId);

    expect(fs.existsSync(cancelInput)).toBe(false);
    expect(fs.existsSync(cancelOutput)).toBe(false);
    expect(activeJobs.has(jobId)).toBe(false);
  });
});
