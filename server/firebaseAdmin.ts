/**
 * Uuda Studio - Firebase Admin (server side identity check)
 *
 * The browser signs in with Firebase Auth and sends the ID token to /api/auth/google. This module checks that
 * token against Google's public keys. Nothing else the browser sends about identity is trusted.
 *
 * Project id comes from FIREBASE_PROJECT_ID, or from firebase-applet-config.json (the same file the browser uses).
 * On Cloud Run the runtime service account supplies credentials automatically; locally, checking a token only
 * needs the project id.
 */

import fs from 'fs';
import path from 'path';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';

function resolveProjectId(): string | undefined {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed.projectId === 'string' ? parsed.projectId : undefined;
  } catch {
    return undefined;
  }
}

export function ensureFirebaseApp() {
  if (getApps().length === 0) {
    const projectId = resolveProjectId();
    if (!projectId) {
      throw new Error('Firebase project id is not configured. Set FIREBASE_PROJECT_ID.');
    }
    initializeApp({ projectId, storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app` });
  }
}

export interface VerifiedIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoUrl: string;
}

/**
 * Verifies a Firebase ID token and returns the identity found inside it.
 * Throws if the token is missing, forged, expired, for another project, or (optionally) revoked.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedIdentity> {
  ensureFirebaseApp();
  const checkRevoked = process.env.FIREBASE_CHECK_REVOKED === 'true';
  const decoded: DecodedIdToken = await getAuth().verifyIdToken(idToken, checkRevoked);
  const email = (decoded.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('The Google account has no email address.');
  }
  return {
    uid: decoded.uid,
    email,
    emailVerified: decoded.email_verified === true,
    displayName: (decoded.name as string) || email.split('@')[0],
    photoUrl: (decoded.picture as string) || '',
  };
}
