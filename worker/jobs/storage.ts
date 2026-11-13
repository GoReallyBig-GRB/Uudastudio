export const DEFAULT_STORAGE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_TAKE_BYTES = 300 * 1024 * 1024;
export const DEFAULT_MAX_TAKE_SECONDS = 2 * 60 * 60;

export interface StorageStatus {
  totalBytes: number;
  limitBytes: number;
  mode: 'guarded' | 'disabled' | 'unavailable';
}

/** The shared storage guard used by the Worker, Express twin, and host-neutral handler tests. */
export interface StorageGuard {
  /** Atomically reserve the declared size before accepting upload chunks. */
  reserve(jobId: string, uploadId: string, bytes: number, limitBytes: number): Promise<boolean> | boolean;
  /** Set this job's completed audio total, and clear the completed upload's reservation. */
  report(jobId: string, bytes: number, uploadId?: string, clearReservations?: boolean): Promise<void> | void;
  /** Release a rejected or abandoned upload reservation. */
  release(jobId: string, uploadId: string): Promise<void> | void;
  status(limitBytes: number): Promise<StorageStatus> | StorageStatus;
}

export interface RegistryStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/** Adapts the global JobRegistry Durable Object to the host-neutral StorageGuard interface. */
export const registryStorage = (stub: RegistryStub): StorageGuard => {
  const call = async (path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const response = await stub.fetch(`https://job-registry.internal/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`JobRegistry ${path} failed (${response.status}).`);
    return await response.json() as Record<string, unknown>;
  };
  return {
    async reserve(jobId, uploadId, bytes, limitBytes) {
      const result = await call('reserve', { jobId, uploadId, bytes, limitBytes });
      return result.allowed === true;
    },
    async report(jobId, bytes, uploadId, clearReservations) { await call('report', { jobId, bytes, uploadId, clearReservations }); },
    async release(jobId, uploadId) { await call('release', { jobId, uploadId }); },
    async status(limitBytes) {
      const result = await call(`status?limitBytes=${encodeURIComponent(String(limitBytes))}`);
      return {
        totalBytes: Number(result.totalBytes) || 0,
        limitBytes: Number(result.limitBytes) || limitBytes,
        mode: result.mode === 'guarded' ? 'guarded' : 'unavailable',
      };
    },
  };
};

/** In-memory implementation for Express's temporary twin and deterministic tests. */
export class MemoryStorageGuard implements StorageGuard {
  private readonly usage = new Map<string, number>();
  private readonly reservations = new Map<string, { jobId: string; bytes: number }>();

  reserve(jobId: string, uploadId: string, bytes: number, limitBytes: number): boolean {
    const existing = this.reservations.get(uploadId);
    if (existing) return existing.jobId === jobId && existing.bytes === bytes;
    const used = [...this.usage.values()].reduce((sum, value) => sum + value, 0);
    const reserved = [...this.reservations.values()].reduce((sum, value) => sum + value.bytes, 0);
    if (used + reserved + bytes > limitBytes) return false;
    this.reservations.set(uploadId, { jobId, bytes });
    return true;
  }

  report(jobId: string, bytes: number, uploadId?: string, clearReservations = false): void {
    if (bytes > 0) this.usage.set(jobId, bytes);
    else this.usage.delete(jobId);
    if (uploadId) this.release(jobId, uploadId);
    if (clearReservations) {
      for (const [id, reservation] of this.reservations) if (reservation.jobId === jobId) this.reservations.delete(id);
    }
  }

  release(jobId: string, uploadId: string): void {
    if (this.reservations.get(uploadId)?.jobId === jobId) this.reservations.delete(uploadId);
  }

  status(limitBytes: number): StorageStatus {
    return {
      totalBytes: [...this.usage.values()].reduce((sum, value) => sum + value, 0),
      limitBytes,
      mode: 'guarded',
    };
  }
}

export const storageLimit = (configured?: string | number): number => {
  const value = Number(configured);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_STORAGE_LIMIT_BYTES;
};

export const takeByteLimit = (configured?: string | number): number => {
  const value = Number(configured);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_TAKE_BYTES;
};

export const takeDurationLimit = (configured?: string | number): number => {
  const value = Number(configured);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_TAKE_SECONDS;
};

export const storageStatusResponse = async (guard: StorageGuard | undefined, limitBytes: number): Promise<Response> => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (!guard) return new Response(JSON.stringify({ totalBytes: 0, limitBytes, mode: 'disabled' } satisfies StorageStatus), { headers });
  try {
    return new Response(JSON.stringify(await guard.status(limitBytes)), { headers });
  } catch {
    return new Response(JSON.stringify({ totalBytes: 0, limitBytes, mode: 'unavailable' } satisfies StorageStatus), { status: 503, headers });
  }
};
