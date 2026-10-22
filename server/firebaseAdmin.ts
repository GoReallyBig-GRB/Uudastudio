/**
 * Uuda Studio - Firebase Admin (server side identity check)
 *
 * The browser signs in with Firebase Auth and sends the ID token to /api/auth/google. This module checks that
 * token against Google's public keys. Nothing else the browser sends about identity is trusted.
 *
 * Project configuration is read from firebase-applet-config.json (matching the browser client),
 * with fallbacks to FIREBASE_PROJECT_ID, GOOGLE_CLOUD_PROJECT, and GCLOUD_PROJECT.
 * On Cloud Run the runtime service account supplies credentials automatically; locally, checking a token only
 * needs the project id and Google's public keys.
 */

import fs from 'fs';
import path from 'path';
import { getApps, initializeApp, App } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';

export interface FirebaseConfigInfo {
  projectId: string;
  databaseId?: string;
  storageBucket?: string;
}

export function resolveFirebaseConfig(): FirebaseConfigInfo {
  let fileConfig: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf-8');
    fileConfig = JSON.parse(raw);
  } catch {
    fileConfig = {};
  }

  // The client applet is bundled with firebase-applet-config.json.
  // Tokens minted in the browser will have audience matching the project in that file.
  // We prefer the file's projectId unless it is missing or placeholder 'remixed-project-id'.
  const fileProjectId =
    typeof fileConfig.projectId === 'string' &&
    fileConfig.projectId &&
    fileConfig.projectId !== 'remixed-project-id'
      ? fileConfig.projectId
      : undefined;

  const projectId =
    fileProjectId ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    'gen-lang-client-0557048278';

  const databaseId =
    (typeof fileConfig.firestoreDatabaseId === 'string' && fileConfig.firestoreDatabaseId) ||
    process.env.FIREBASE_DATABASE_ID ||
    undefined;

  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    (typeof fileConfig.storageBucket === 'string' && fileConfig.storageBucket) ||
    `${projectId}.firebasestorage.app`;

  return { projectId, databaseId, storageBucket };
}

export function getAllowedProjectIds(): Set<string> {
  const allowed = new Set<string>();
  const conf = resolveFirebaseConfig();
  if (conf.projectId) allowed.add(conf.projectId);
  if (process.env.FIREBASE_PROJECT_ID) allowed.add(process.env.FIREBASE_PROJECT_ID);
  if (process.env.GOOGLE_CLOUD_PROJECT) allowed.add(process.env.GOOGLE_CLOUD_PROJECT);
  if (process.env.GCLOUD_PROJECT) allowed.add(process.env.GCLOUD_PROJECT);
  return allowed;
}

export function getAppForProjectId(targetProjectId?: string): App {
  const defaultProjectId = resolveFirebaseConfig().projectId;
  const desiredId = targetProjectId || defaultProjectId;

  // Check if an app is already initialized for this project
  const existing = getApps().find(
    (a) => a.name === desiredId || (a.name === '[DEFAULT]' && a.options.projectId === desiredId)
  );
  if (existing) return existing;

  // If no default app exists yet and this is the default project, initialize default app
  if (getApps().length === 0) {
    const config = resolveFirebaseConfig();
    return initializeApp({
      projectId: desiredId,
      storageBucket: config.storageBucket,
    });
  }

  // Otherwise, initialize a named app for this specific project ID
  return initializeApp(
    {
      projectId: desiredId,
      storageBucket: `${desiredId}.firebasestorage.app`,
    },
    desiredId
  );
}

export function ensureFirebaseApp(): App {
  return getAppForProjectId();
}

/**
 * Extracts audience ("aud") claim from unverified JWT payload for app routing.
 * Signature and validity are ALWAYS cryptographically validated by getAuth().verifyIdToken.
 */
function extractTokenAudience(idToken: string): string | undefined {
  try {
    const parts = idToken.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (typeof payload.aud === 'string' && payload.aud) return payload.aud;
    }
  } catch {
    // Malformed token - will fail signature verification downstream
  }
  return undefined;
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
  const allowed = getAllowedProjectIds();
  const tokenAud = extractTokenAudience(idToken);

  let appToUse: App;
  if (tokenAud && allowed.has(tokenAud)) {
    appToUse = getAppForProjectId(tokenAud);
  } else {
    appToUse = ensureFirebaseApp();
  }

  const checkRevoked = process.env.FIREBASE_CHECK_REVOKED === 'true';
  const decoded: DecodedIdToken = await getAuth(appToUse).verifyIdToken(idToken, checkRevoked);
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
