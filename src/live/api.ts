import { authService } from '../services/authService';
import type { LiveEvent, LiveFile, LiveParticipant } from './events';

export class LiveApiError extends Error { constructor(public status: number, message: string) { super(message); } }

const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`/api/live/${path}`, { ...init, credentials: 'same-origin', headers: { ...authService.getAuthHeaders(), ...(init.headers as Record<string, string> | undefined) } });
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new LiveApiError(res.status, body.error || `Request failed (${res.status})`);
  return body as T;
};

export interface EventDraft { kind: 'scheduled' | 'quick'; title: string; description: string; notes: string; startsAt: number | null; durationMin: number | null; participants: LiveParticipant[] }

export interface LiveQuota { used: number; limit: number; left: number; resetsAt: number | null; sessionMinutes: number; maxPeople: number }
export const listEvents = () => call<{ now: number; quota?: LiveQuota; events: LiveEvent[] }>('events');
export const createEvent = (d: EventDraft) => call<LiveEvent>('events', { method: 'POST', body: JSON.stringify(d) });
export const updateEvent = (id: string, d: EventDraft) => call<LiveEvent>(`events/${id}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteEvent = (id: string) => call<{ ok: true }>(`events/${id}`, { method: 'DELETE' });
export const setEventOpen = (id: string, open: boolean) => call<LiveEvent>(`events/${id}/activate`, { method: 'POST', body: JSON.stringify({ open }) });
export const uploadEventFile = (id: string, file: File) => call<LiveFile>(`events/${id}/files?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } });
export const deleteEventFile = (id: string, fileId: string) => call<{ ok: true }>(`events/${id}/files/${fileId}`, { method: 'DELETE' });

export interface JoinInfo { title: string; description: string; notes: string; startsAt: number | null; durationMin: number | null; host: string; state: 'waiting' | 'open' | 'ended'; now: number; files: LiveFile[] }
export const getJoinInfo = async (token: string): Promise<JoinInfo> => {
  const res = await fetch(`/api/live/join/${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => ({})) as JoinInfo & { error?: string };
  if (!res.ok) throw new LiveApiError(res.status, body.error || 'This link is not valid.');
  return body;
};
