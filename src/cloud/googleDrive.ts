/**
 * Google Drive connection. Uses only the "drive.file" permission: Uuda can see and change just the files it makes itself
 * (the .uuda projects in a "Uuda Studio" folder), never the rest of the person's Drive. The access token lasts about an hour
 * and is kept in memory only, never written to browser storage; after that the person taps Connect again.
 */
import { GoogleAuthProvider, linkWithPopup, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from '../services/firebase';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER_NAME = 'Uuda Studio';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const CHUNK = 8 * 1024 * 1024; // a multiple of 256 KiB, as Drive requires for resumable pieces

export interface DriveProject { id: string; name: string; modifiedTime: string; size: number }

let token: { value: string; expires: number } | null = null;
const listeners = new Set<() => void>();
export const onDriveChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const changed = () => listeners.forEach((fn) => fn());

export const isDriveConnected = (): boolean => !!token && token.expires > Date.now();
export const disconnectDrive = (): void => { token = null; changed(); };

export const driveErrorText = (e: unknown): string => {
  const code = (e as { code?: string })?.code || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'The Google window was closed before finishing.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
  if (code === 'auth/credential-already-in-use') return 'That Google account is already used by another Uuda account.';
  return e instanceof Error ? e.message : 'Google Drive did not answer.';
};

/** Asks Google for permission to Uuda's own files. Must be called from a click (it opens a window). */
export async function connectDrive(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to Uuda first, then connect Google Drive.');
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);
  if (user.email) provider.setCustomParameters({ login_hint: user.email });
  let result;
  try {
    result = await reauthenticateWithPopup(user, provider);
  } catch (e) {
    const code = (e as { code?: string })?.code || '';
    if (code === 'auth/user-mismatch' || code === 'auth/provider-not-linked' || code === 'auth/requires-recent-login') {
      result = await linkWithPopup(user, provider);
    } else throw e;
  }
  const cred = GoogleAuthProvider.credentialFromResult(result);
  if (!cred?.accessToken) throw new Error('Google did not give Uuda access to Drive.');
  token = { value: cred.accessToken, expires: Date.now() + 55 * 60_000 };
  changed();
}

const authed = async (url: string, init: RequestInit = {}): Promise<Response> => {
  if (!isDriveConnected()) { token = null; changed(); throw new Error('Google Drive is not connected. Connect it in Settings, Connections.'); }
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token!.value}` } });
  if (res.status === 401) { token = null; changed(); throw new Error('Google Drive access ended. Connect it again in Settings, Connections.'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } })?.error?.message;
    if (res.status === 403 && /has not been used|disabled/i.test(msg || '')) throw new Error('Google Drive is not switched on for this project yet (the Google Drive API must be enabled).');
    throw new Error(msg || `Google Drive error ${res.status}.`);
  }
  return res;
};

const folderQuery = `name = '${DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

async function ensureFolder(): Promise<string> {
  const found = await (await authed(`${API}/files?q=${encodeURIComponent(folderQuery)}&fields=files(id)&spaces=drive`)).json();
  if (found.files?.[0]?.id) return found.files[0].id as string;
  const made = await (await authed(`${API}/files?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })).json();
  return made.id as string;
}

/** The .uuda projects Uuda has saved to Drive, newest first. */
export async function listDriveProjects(): Promise<DriveProject[]> {
  const q = `trashed = false and name contains '.uuda' and mimeType != 'application/vnd.google-apps.folder'`;
  const res = await (await authed(`${API}/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=50&fields=files(id,name,modifiedTime,size)`)).json();
  return ((res.files || []) as Array<{ id: string; name: string; modifiedTime: string; size?: string }>)
    .map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: Number(f.size || 0) }));
}

/** Saves (or replaces) a project file in the Uuda Studio folder, sending it in pieces so big projects do not need to fit in one request. */
export async function saveToDrive(name: string, blob: Blob, onProgress?: (sent: number, total: number) => void): Promise<void> {
  const folderId = await ensureFolder();
  const existing = await (await authed(`${API}/files?q=${encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`)}&fields=files(id)`)).json();
  const fileId: string | undefined = existing.files?.[0]?.id;
  const start = await authed(
    fileId ? `${UPLOAD}/files/${fileId}?uploadType=resumable` : `${UPLOAD}/files?uploadType=resumable`,
    {
      method: fileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) },
      body: JSON.stringify(fileId ? {} : { name, parents: [folderId] }),
    },
  );
  const session = start.headers.get('Location');
  if (!session) throw new Error('Google Drive did not start the upload.');
  const total = blob.size;
  for (let sent = 0; sent < total || total === 0;) {
    const end = Math.min(total, sent + CHUNK);
    const res = await fetch(session, {
      method: 'PUT',
      headers: { 'Content-Range': total === 0 ? 'bytes */0' : `bytes ${sent}-${end - 1}/${total}` },
      body: blob.slice(sent, end),
    });
    if (res.status === 200 || res.status === 201) { onProgress?.(total, total); return; }
    if (res.status !== 308) throw new Error(`Google Drive stopped the upload (${res.status}).`);
    sent = end;
    onProgress?.(sent, total);
  }
}

/** Downloads a project from Drive as a File the normal open path can read. */
export async function openFromDrive(item: DriveProject): Promise<File> {
  const res = await authed(`${API}/files/${item.id}?alt=media`);
  return new File([await res.blob()], item.name, { type: 'application/octet-stream' });
}
