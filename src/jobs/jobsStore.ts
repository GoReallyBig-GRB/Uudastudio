/** The producer's list of jobs, kept in this browser (the keys that open each job's thread). Pure apart from the storage passed in. */

export interface StoredJob {
  id: string;
  producerKey: string;
  title: string;
  createdAt: number;
  /** Highest message id the producer has seen */
  lastRead: number;
  /** Same for the client thread */
  lastReadClient?: number;
}

const KEY = 'uuda-jobs-v1';
export const CODE_KEY = 'uuda-jobs-create-code';

export const loadJobs = (storage: Pick<Storage, 'getItem'>): StoredJob[] => {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((j) => j && typeof j.id === 'string' && typeof j.producerKey === 'string').map((j) => ({ id: j.id, producerKey: j.producerKey, title: String(j.title ?? 'Voice recording'), createdAt: Number(j.createdAt) || 0, lastRead: Number(j.lastRead) || 0, lastReadClient: Number(j.lastReadClient) || 0 }));
  } catch { return []; }
};

export const saveJobs = (storage: Pick<Storage, 'setItem'>, jobs: StoredJob[]): void => {
  try { storage.setItem(KEY, JSON.stringify(jobs)); } catch { /* not saved: the list is lost on reload */ }
};

export const addJob = (jobs: StoredJob[], j: Omit<StoredJob, 'lastRead' | 'lastReadClient'>): StoredJob[] => [{ ...j, lastRead: 0, lastReadClient: 0 }, ...jobs.filter((x) => x.id !== j.id)];
export const removeJob = (jobs: StoredJob[], id: string): StoredJob[] => jobs.filter((j) => j.id !== id);
/** The same list (not a copy) when nothing changes, so setting it again does not re-render everything */
export const markRead = (jobs: StoredJob[], id: string, lastRead: number): StoredJob[] =>
  jobs.some((j) => j.id === id && lastRead > j.lastRead) ? jobs.map((j) => (j.id === id && lastRead > j.lastRead ? { ...j, lastRead } : j)) : jobs;

export const markReadClient = (jobs: StoredJob[], id: string, last: number): StoredJob[] =>
  jobs.some((j) => j.id === id && last > (j.lastReadClient ?? 0)) ? jobs.map((j) => (j.id === id && last > (j.lastReadClient ?? 0) ? { ...j, lastReadClient: last } : j)) : jobs;

/** Messages from the talent that the producer has not read yet */
export const unreadCount = (messages: { id: number; role: string }[], lastRead: number): number => messages.filter((m) => m.id > lastRead && m.role !== 'producer').length;

export type JobStatus = 'waiting' | 'take' | 'talking';
/** Where the job stands, from its messages */
export const statusOf = (messages: { role: string; attachment: unknown }[]): JobStatus =>
  messages.some((m) => m.role === 'talent' && m.attachment) ? 'take' : messages.some((m) => m.role === 'talent') ? 'talking' : 'waiting';
export const STATUS_TEXT: Record<JobStatus, string> = { waiting: 'Waiting for the talent', talking: 'Talent has written', take: 'Take received' };
