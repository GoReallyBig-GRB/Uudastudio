import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./firebaseAdmin', () => ({
  verifyFirebaseIdToken: vi.fn(async () => {
    throw new Error('Invalid signature');
  }),
}));

import { verifyFirebaseIdToken } from './firebaseAdmin';
import { authRouter } from './authRoutes';

const app = express();
app.use(express.json());
app.use(authRouter);

let server: ReturnType<typeof app.listen>;

beforeEach(async () => {
  vi.mocked(verifyFirebaseIdToken).mockRejectedValue(new Error('Invalid signature'));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function postSignIn(body: unknown) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port');
  return fetch(`http://127.0.0.1:${address.port}/api/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Google sign-in security', () => {
  it('rejects identity fields supplied without a Firebase ID token', async () => {
    const response = await postSignIn({
      googleId: 'forged-admin-id',
      email: 'admin@example.com',
      displayName: 'Administrator',
    });

    expect(response.status).toBe(400);
    expect(verifyFirebaseIdToken).not.toHaveBeenCalled();
  });

  it('rejects a forged token when Firebase verification fails', async () => {
    const response = await postSignIn({
      idToken: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoiYWRtaW5AZXhhbXBsZS5jb20ifQ.',
      googleId: 'forged-admin-id',
      email: 'admin@example.com',
    });

    expect(response.status).toBe(401);
    expect(verifyFirebaseIdToken).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      error: 'Google sign-in could not be verified. Please try again.',
    });
  });
});
