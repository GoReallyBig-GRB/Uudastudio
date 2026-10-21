/**
 * Uuda Studio - Client Authentication & User Service
 * Production-grade Firebase Google Authentication with GoogleAuthProvider popup/redirect.
 * Firestore user profile syncing, RBAC (user & admin roles),
 * volatile memory token isolation to protect against third-party plugin script snooping,
 * and Firebase onAuthStateChanged observer synchronization.
 */

import { UserRecord, UserPreferences } from '../types';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  fbSignOut,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  db as firestoreDb,
} from './firebase';

class AuthService {
  private currentUser: UserRecord | null = null;
  private unreadTicketsCount = 0;
  private isAdminVerified = false;
  private isInitializing = true;

  // Credential Isolation: strictly scoped volatile memory to prevent third-party WAM scripts from reading sensitive tokens
  private volatileToken: string | null = null;
  private volatileGeminiKey: string | null = null;

  constructor() {
    this.setupFirebaseObserver();
    if (this.hasDevSessionFlag()) {
      void this.restoreDevSession();
    }
  }

  // Testing-only sign-in (see DEV_AUTH_BYPASS on the server). The flag lives in sessionStorage so a reload keeps the
  // testing session; the session itself is the server's httpOnly cookie, never a token in storage.
  private hasDevSessionFlag(): boolean {
    try {
      return typeof window !== 'undefined' && window.sessionStorage.getItem('uuda_dev_session') === '1';
    } catch {
      return false;
    }
  }

  private setDevSessionFlag(on: boolean) {
    try {
      if (on) window.sessionStorage.setItem('uuda_dev_session', '1');
      else window.sessionStorage.removeItem('uuda_dev_session');
    } catch {
      /* storage unavailable: the testing session just will not survive a reload */
    }
  }

  private async restoreDevSession(): Promise<void> {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = res.ok ? await res.json() : null;
      if (data && data.user) {
        this.currentUser = data.user;
        this.unreadTicketsCount = data.unreadTicketsCount || 0;
        this.isAdminVerified = Boolean(data.isAdminVerified);
      } else {
        this.setDevSessionFlag(false);
      }
    } catch {
      /* server unreachable: stay signed out */
    } finally {
      this.isInitializing = false;
      this.notifyAuthChanged();
    }
  }

  /** True when the server has the testing sign-in switched on. */
  public async isDevLoginAvailable(): Promise<boolean> {
    try {
      const res = await fetch('/api/auth/dev-status', { credentials: 'same-origin' });
      if (!res.ok) return false;
      const data = await res.json();
      return Boolean(data.enabled);
    } catch {
      return false;
    }
  }

  /** Testing-only: signs in the non-admin tester account when the server allows it. */
  public async signInAsDevTester(): Promise<{ user: UserRecord; isNew: boolean; adminCodeSent: boolean }> {
    const res = await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'The testing sign-in is not available on this server.');
    }
    this.setDevSessionFlag(true);
    this.currentUser = data.user;
    this.volatileToken = data.sessionToken || null;
    this.isAdminVerified = false;
    this.isInitializing = false;
    this.notifyAuthChanged();
    void this.refreshMe();
    return { user: data.user, isNew: Boolean(data.isNew), adminCodeSent: false };
  }

  /**
   * Firebase onAuthStateChanged observer: binds authentication state transitions,
   * syncs user context across UI components, and ensures memory cleanup on sign-out.
   */
  private setupFirebaseObserver() {
    if (typeof window === 'undefined') return;

    onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const idToken = await fbUser.getIdToken();
          this.volatileToken = idToken;

          // Sync with Firestore user document
          await this.syncFirestoreUserProfile(fbUser);

          // Authenticate with server to fetch user record & roles
          await this.syncWithBackend(idToken, {
            googleId: fbUser.uid,
            email: fbUser.email || '',
            displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Producer',
            photoUrl: fbUser.photoURL || '',
          });
        } catch (err) {
          console.warn('Firebase auth state sync warning:', err);
        } finally {
          this.isInitializing = false;
          this.notifyAuthChanged();
        }
      } else {
        // A testing session has no Firebase user by design; do not wipe it here (restoreDevSession owns that state)
        if (this.hasDevSessionFlag()) {
          this.isInitializing = false;
          this.notifyAuthChanged();
          return;
        }
        // Complete memory cleanup on sign-out
        this.volatileToken = null;
        this.volatileGeminiKey = null;
        this.currentUser = null;
        this.unreadTicketsCount = 0;
        this.isAdminVerified = false;
        this.isInitializing = false;
        this.notifyAuthChanged();
      }
    });

    // Check for redirect result if popup was blocked
    getRedirectResult(auth)
      .then(async (result) => {
        if (result && result.user) {
          const idToken = await result.user.getIdToken();
          this.volatileToken = idToken;
          await this.syncFirestoreUserProfile(result.user);
          await this.syncWithBackend(idToken, {
            googleId: result.user.uid,
            email: result.user.email || '',
            displayName: result.user.displayName || result.user.email?.split('@')[0] || 'Producer',
            photoUrl: result.user.photoURL || '',
          });
        }
      })
      .catch((err) => {
        console.warn('Firebase redirect result check:', err);
      });
  }

  /**
   * Syncs user profile document in Firestore (/users/{userId})
   */
  private async syncFirestoreUserProfile(fbUser: import('firebase/auth').User): Promise<void> {
    try {
      const userDocRef = doc(firestoreDb, 'users', fbUser.uid);
      const snap = await getDoc(userDocRef);

      if (!snap.exists()) {
        // Create initial user profile adhering to firestore.rules (role must be 'user', blocked must be false)
        await setDoc(userDocRef, {
          id: fbUser.uid,
          email: fbUser.email || '',
          displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Producer',
          photoURL: fbUser.photoURL || '',
          role: 'user',
          blocked: false,
          lastActiveAt: Date.now(),
        });
      } else {
        // Update display metadata
        await updateDoc(userDocRef, {
          displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Producer',
          photoURL: fbUser.photoURL || '',
          lastActiveAt: Date.now(),
        });
      }
    } catch (err) {
      console.warn('Firestore user doc sync notice:', err);
    }
  }

  private async syncWithBackend(
    token: string,
    profile: { googleId: string; email: string; displayName: string; photoUrl: string }
  ): Promise<void> {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ idToken: token }),
        credentials: 'same-origin',
      });

      if (res.ok) {
        const data = await res.json();
        this.currentUser = data.user;
        this.volatileToken = data.sessionToken || null;
        if (data.adminCodeSent) {
          this.isAdminVerified = false;
        }
      }
    } catch (err) {
      console.warn('Backend session sync warning:', err);
    }
  }

  public getToken(): string | null {
    return this.volatileToken;
  }

  public setToken(token: string | null) {
    this.volatileToken = token;
  }

  // Volatile In-Memory Own Gemini API Key (Mitigates third-party script exploitation)
  public getOwnGeminiKey(): string | null {
    return this.volatileGeminiKey;
  }

  public setOwnGeminiKey(key: string | null) {
    this.volatileGeminiKey = key && key.trim() ? key.trim() : null;
    this.notifyAuthChanged();
  }

  public getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const ownKey = this.getOwnGeminiKey();
    if (ownKey) {
      headers['x-gemini-api-key'] = ownKey;
    }
    return headers;
  }

  private notifyAuthChanged() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('uuda:auth-changed', {
          detail: {
            user: this.currentUser,
            unreadTicketsCount: this.unreadTicketsCount,
            isAdminVerified: this.isAdminVerified,
          },
        })
      );
    }
  }

  public async initSession(): Promise<UserRecord | null> {
    // If volatile token is present, refresh /api/auth/me
    if (!this.volatileToken) {
      return null;
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: this.getAuthHeaders(),
      });
      if (!res.ok) {
        this.currentUser = null;
      } else {
        const data = await res.json();
        this.currentUser = data.user;
        this.unreadTicketsCount = data.unreadTicketsCount || 0;
        this.isAdminVerified = Boolean(data.isAdminVerified);
      }
    } catch {
      this.currentUser = null;
    } finally {
      this.notifyAuthChanged();
    }

    return this.currentUser;
  }

  public getUser(): UserRecord | null {
    return this.currentUser;
  }

  public getUnreadTicketsCount(): number {
    return this.unreadTicketsCount;
  }

  public isUserAdminVerified(): boolean {
    return this.isAdminVerified;
  }

  public isLoading(): boolean {
    return this.isInitializing;
  }

  /**
   * Production-grade Google Authentication via Firebase GoogleAuthProvider
   */
  public async signInWithFirebaseGoogle(): Promise<{
    user: UserRecord;
    isNew: boolean;
    adminCodeSent: boolean;
  }> {
    try {
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      let userCredential;

      try {
        userCredential = await signInWithPopup(auth, googleProvider);
      } catch (popupErr: any) {
        // If popup was blocked or failed due to iframe constraints, fall back to redirect
        if (
          popupErr.code === 'auth/popup-blocked' ||
          popupErr.code === 'auth/popup-closed-by-user' ||
          popupErr.code === 'auth/cancelled-popup-request'
        ) {
          console.info('Popup constrained, falling back to signInWithRedirect...');
          await signInWithRedirect(auth, googleProvider);
          throw new Error('Redirecting to Google Sign-In...');
        }
        throw popupErr;
      }

      const fbUser = userCredential.user;
      const idToken = await fbUser.getIdToken();
      this.volatileToken = idToken;

      await this.syncFirestoreUserProfile(fbUser);

      // Authenticate with server
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        // The server verifies this token with Firebase and reads the identity from it; nothing else is trusted
        body: JSON.stringify({ idToken }),
        credentials: 'same-origin',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to authenticate with backend');
      }

      this.currentUser = data.user;
      this.volatileToken = data.sessionToken || null;
      this.isAdminVerified = false;
      this.notifyAuthChanged();

      this.refreshMe();

      return {
        user: data.user,
        isNew: data.isNew,
        adminCodeSent: Boolean(data.adminCodeSent),
      };
    } catch (err: unknown) {
      console.error('Firebase Google Sign-In Error:', err);
      throw err;
    }
  }

  public async refreshMe(): Promise<void> {
    const token = this.getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/auth/me', {
        headers: this.getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        this.currentUser = data.user;
        this.unreadTicketsCount = data.unreadTicketsCount || 0;
        this.isAdminVerified = Boolean(data.isAdminVerified);
        this.notifyAuthChanged();
      }
    } catch {}
  }

  // Sign out: tears down Firebase session and thoroughly purges memory credentials
  public async signOut(): Promise<void> {
    // Clear the testing flag first so the Firebase observer treats this as a normal sign-out
    this.setDevSessionFlag(false);
    try {
      await fbSignOut(auth);
      await fetch('/api/auth/signout', {
        method: 'POST',
        headers: this.getAuthHeaders(),
      }).catch(() => {});
    } catch (e) {
      console.warn('Sign-out exception:', e);
    } finally {
      this.volatileToken = null;
      this.volatileGeminiKey = null;
      this.currentUser = null;
      this.unreadTicketsCount = 0;
      this.isAdminVerified = false;
      this.notifyAuthChanged();
    }
  }

  public async updateProfile(updates: {
    display_name?: string;
    preferences?: Partial<UserPreferences>;
  }): Promise<UserRecord> {
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update profile');
    }

    this.currentUser = data.user;
    this.notifyAuthChanged();
    return data.user;
  }

  public async deleteAccount(confirmText: string): Promise<void> {
    const res = await fetch('/api/auth/account', {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ confirmText }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete account');
    }

    await this.signOut();
  }

  public async verifyAdminCode(code: string): Promise<boolean> {
    const res = await fetch('/api/admin/verify-code', {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ code }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Invalid connection code');
    }

    this.isAdminVerified = true;
    this.notifyAuthChanged();
    return true;
  }

  public async resendAdminCode(): Promise<string> {
    const res = await fetch('/api/admin/resend-code', {
      method: 'POST',
      headers: this.getAuthHeaders(),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to resend connection code');
    }

    return data.message || 'A new code was sent to your email.';
  }
}

export const authService = new AuthService();
