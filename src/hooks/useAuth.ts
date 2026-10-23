/**
 * Uuda Pro - useAuth Hook
 * Reactive hook for authentication state, user profile, unread tickets, and admin rights.
 */

import { useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';
import { UserRecord, UserPreferences } from '../types';

export function useAuth() {
  const [user, setUser] = useState<UserRecord | null>(authService.getUser());
  const [isLoading, setIsLoading] = useState<boolean>(authService.isLoading());
  const [unreadTicketsCount, setUnreadTicketsCount] = useState<number>(authService.getUnreadTicketsCount());
  const [isAdminVerified, setIsAdminVerified] = useState<boolean>(authService.isUserAdminVerified());

  useEffect(() => {
    const handleAuthChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setUser(detail.user);
      setUnreadTicketsCount(detail.unreadTicketsCount || 0);
      setIsAdminVerified(Boolean(detail.isAdminVerified));
      setIsLoading(false);
    };

    window.addEventListener('uuda:auth-changed', handleAuthChange);

    // Initial check if not yet initialized
    authService.initSession().then((u) => {
      setUser(u);
      setUnreadTicketsCount(authService.getUnreadTicketsCount());
      setIsAdminVerified(authService.isUserAdminVerified());
      setIsLoading(false);
    });

    return () => {
      window.removeEventListener('uuda:auth-changed', handleAuthChange);
    };
  }, []);

  const signOut = useCallback(async () => {
    return authService.signOut();
  }, []);

  const updateProfile = useCallback(
    async (updates: { display_name?: string; preferences?: Partial<UserPreferences> }) => {
      return authService.updateProfile(updates);
    },
    []
  );

  const deleteAccount = useCallback(async (confirmText: string) => {
    return authService.deleteAccount(confirmText);
  }, []);

  const verifyAdminCode = useCallback(async (code: string) => {
    return authService.verifyAdminCode(code);
  }, []);

  const resendAdminCode = useCallback(async () => {
    return authService.resendAdminCode();
  }, []);

  return {
    user,
    isLoading,
    isAdmin: user?.role === 'admin',
    isAdminVerified,
    unreadTicketsCount,
    signOut,
    updateProfile,
    deleteAccount,
    verifyAdminCode,
    resendAdminCode,
    refreshUser: () => authService.refreshMe(),
  };
}
