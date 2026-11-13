import { describe, expect, it } from 'vitest';
import { MemoryStorageGuard, storageStatusResponse } from './storage';

describe('MemoryStorageGuard', () => {
  it('reserves capacity atomically and sets per-job totals instead of incrementing', async () => {
    const guard = new MemoryStorageGuard();
    expect(await guard.reserve('job-a', 'upload-a', 700, 1000)).toBe(true);
    expect(await guard.reserve('job-b', 'upload-b', 301, 1000)).toBe(false);
    guard.report('job-a', 700, 'upload-a');
    expect(await guard.reserve('job-b', 'upload-b', 300, 1000)).toBe(true);
    guard.report('job-a', 500);
    expect(guard.status(1000).totalBytes).toBe(500);
    guard.report('job-a', 200);
    expect(guard.status(1000).totalBytes).toBe(200);
  });

  it('reports a no-registry status without job details', async () => {
    const response = await storageStatusResponse(undefined, 4096);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ totalBytes: 0, limitBytes: 4096, mode: 'disabled' });
  });

  it('keeps in-flight reservations when a purge sets completed bytes to zero', async () => {
    const guard = new MemoryStorageGuard();
    expect(guard.reserve('job-a', 'upload-a', 700, 1000)).toBe(true);
    guard.report('job-a', 0);
    expect(guard.reserve('job-b', 'upload-b', 301, 1000)).toBe(false);
    guard.report('job-a', 0, undefined, true);
    expect(guard.reserve('job-b', 'upload-b', 1000, 1000)).toBe(true);
  });
});
