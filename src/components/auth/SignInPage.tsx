/**
 * Uuda Pro - Unified Sign Up / Sign In Page
 * Single dual page for all users and administrators.
 * Primary Action: 'Continue with Google'.
 * Signed-out fallback: 'Use the editor without an account'.
 */

import React, { useState } from 'react';
import { Shield, Sparkles, AlertCircle, ArrowLeft, Lock } from 'lucide-react';
import { authService } from '../../services/authService';

interface SignInPageProps {
  onContinueAsGuest: () => void;
  onSuccessSignIn: (info?: { adminCodeSent?: boolean }) => void;
}

export const SignInPage: React.FC<SignInPageProps> = ({ onContinueAsGuest, onSuccessSignIn }) => {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFirebaseGoogleSignIn = async () => {
    setIsSigningIn(true);
    setErrorMessage(null);

    try {
      const res = await authService.signInWithFirebaseGoogle();
      setIsSigningIn(false);
      onSuccessSignIn({
        adminCodeSent: res.adminCodeSent,
      });
    } catch (err: unknown) {
      setIsSigningIn(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Redirecting to Google Sign-In')) {
        setIsSigningIn(true);
        return;
      }
      setErrorMessage(msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#08080A] flex flex-col justify-between overflow-y-auto antialiased select-none font-sans">
      {/* Top Bar with Brand and Back Navigation */}
      <header className="h-16 px-6 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-[0_0_15px_rgba(0,240,255,0.3)]">
            <span className="font-extrabold text-white text-sm tracking-wider">U</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-lg tracking-wider text-white">UUDA</span>
              <span className="text-[10px] uppercase font-bold tracking-widest text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-1.5 py-0.5 rounded-sm">
                PRO
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">Browser-Based Audio Studio for Broadcast & Podcasts</p>
          </div>
        </div>

        <button
          onClick={onContinueAsGuest}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-cyan-300 transition-colors cursor-pointer px-3 py-1.5 rounded-md hover:bg-zinc-800/60 border border-transparent hover:border-zinc-700/60"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Studio</span>
        </button>
      </header>

      {/* Main Center Card */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#111116] border border-zinc-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Header Title */}
          <div className="text-center mb-8 relative">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-700/60 mb-4 shadow-inner">
              <Sparkles className="w-6 h-6 text-cyan-400" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Sign in to UUDA PRO</h1>
            <p className="text-sm text-zinc-400 mt-2">
              New or returning? <span className="text-zinc-200 font-medium">Continue with Google</span>
            </p>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="mb-6 p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/70 text-rose-200 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">
                <span>{errorMessage}</span>
                {errorMessage.includes('blocked') && (
                  <p className="mt-1 text-[11px] text-rose-300/80">
                    Your account has been deactivated. For inquiries, please reach out to support.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Primary Action Button: Continue with Google */}
          {(
            <div className="space-y-4">
              <button
                type="button"
                onClick={handleFirebaseGoogleSignIn}
                disabled={isSigningIn}
                className="w-full h-12 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 font-semibold text-sm flex items-center justify-center gap-3 transition-all shadow-[0_2px_12px_rgba(255,255,255,0.15)] hover:shadow-[0_4px_16px_rgba(255,255,255,0.25)] cursor-pointer active:scale-[0.99] disabled:opacity-50"
              >
                {/* Official Google G Logo */}
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{isSigningIn ? 'Connecting via Firebase...' : 'Continue with Google'}</span>
              </button>

              {/* Smaller link: Use the editor without an account */}
              <div className="pt-3 text-center">
                <button
                  type="button"
                  onClick={onContinueAsGuest}
                  className="text-xs text-zinc-400 hover:text-cyan-300 underline underline-offset-4 transition-colors cursor-pointer"
                >
                  Use the editor without an account
                </button>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Offline recorder, library import & mastering remain free; voice generation requires sign-in.
                </p>
              </div>
            </div>
          )}

          {/* Privacy & Policy Note */}
          <div className="mt-8 pt-4 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <Lock className="w-3 h-3 text-zinc-600" />
              <span>Permanent Google ID Identity</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-zinc-600" />
              <span>Standard Free Quota</span>
            </span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-12 px-6 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500 shrink-0">
        <div>Uuda Studio • Professional Broadcast & Podcast Audio DAW</div>
        <div className="flex gap-4">
          <span>Standard Google Quota</span>
          <span>ITU-R BS.1770 Mastering</span>
        </div>
      </footer>
    </div>
  );
};
