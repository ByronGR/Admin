'use client';

import { useState, useEffect, Suspense, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  auth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  isNearworkEmail,
  signInWithMicrosoft,
  MicrosoftNeedsLinkError,
  hasPendingMicrosoftLink,
  linkPendingMicrosoft,
} from '@/lib/firebase';
import { Spinner } from '@/components/ui/spinner';
import { PasswordInput } from '@/components/ui/password-input';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [msLoading, setMsLoading] = useState(false);
  // Password sign-in stays available as a fallback while Microsoft is being
  // rolled out, so a misconfiguration can't lock the team out. Remove it once
  // Microsoft is confirmed working for everyone.
  const [showPassword, setShowPasswordLogin] = useState(false);

  // If already authed, redirect
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u && isNearworkEmail(u.email ?? '')) {
        router.replace('/dashboard');
      } else {
        setCheckingAuth(false);
      }
    });
    return unsub;
  }, [router]);

  // Error from query param
  useEffect(() => {
    const err = searchParams?.get('error');
    if (err === 'not_nearwork') {
      setError('Access restricted to @nearwork.co accounts.');
    }
  }, [searchParams]);

  async function handleMicrosoft() {
    setError('');
    setMsLoading(true);
    try {
      await signInWithMicrosoft();
      router.replace('/dashboard');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const msg = (err as { message?: string })?.message;
      if (err instanceof MicrosoftNeedsLinkError) {
        // First Microsoft sign-in for an account that already has a password.
        // Confirm with the password once and we attach Microsoft to it.
        setEmail(err.emailToLink);
        setShowPasswordLogin(true);
        setError('One-time step: enter your current Admin password to connect Microsoft to your account. Next time, the Microsoft button is all you need.');
      } else if (msg === 'not_nearwork') {
        setError('That Microsoft account isn’t a @nearwork.co address.');
      } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('');
      } else if (code === 'auth/popup-blocked') {
        setError('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.');
      } else if (code === 'auth/operation-not-allowed') {
        setError('Microsoft sign-in isn’t switched on yet in Firebase. Ask an admin to enable it.');
      } else {
        setError('Microsoft sign-in failed. Please try again.');
      }
    } finally {
      setMsLoading(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!isNearworkEmail(email)) {
      setError('Only @nearwork.co email addresses are allowed.');
      return;
    }
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // If they arrived here from the Microsoft button, attach that identity to
      // this account now so the password isn't needed again.
      if (hasPendingMicrosoftLink()) {
        await linkPendingMicrosoft(cred.user);
      }
      router.replace('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { code?: string })?.code;
      if (msg === 'auth/user-not-found' || msg === 'auth/wrong-password' || msg === 'auth/invalid-credential') {
        setError('Invalid email or password.');
      } else {
        setError('Sign in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    if (!resetEmail) return;
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setResetSent(true);
    } catch {
      setError('Could not send reset email.');
    } finally {
      setLoading(false);
    }
  }

  if (checkingAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-[380px]">
        {/* Card */}
        <div className="rounded-2xl border border-[var(--border)] bg-white px-8 py-10 shadow-sm">
          {/* Logo */}
          <div className="mb-8 text-center">
            <h1
              className="text-2xl font-800 tracking-tight"
              style={{ color: 'var(--green)' }}
            >
              nearwork
            </h1>
            <p className="mt-1 text-xs font-500 text-[var(--light)]">
              Admin Dashboard
            </p>
          </div>

          {!showReset ? (
            <>
              <h2 className="mb-6 text-base font-600 text-[var(--black)]">
                Sign in
              </h2>

              {error && (
                <div className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-xs font-500 text-red-700">
                  {error}
                </div>
              )}

              {/* Primary: Microsoft. Uses the Nearwork work account, so there's
                  no separate Admin password to manage or reset. */}
              <button
                type="button"
                onClick={handleMicrosoft}
                disabled={msLoading}
                className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[var(--border)] bg-white py-2.5 text-sm font-600 text-[var(--black)] transition-colors hover:bg-[var(--bg)] disabled:opacity-60"
              >
                {msLoading ? (
                  <Spinner size="sm" />
                ) : (
                  <svg width="17" height="17" viewBox="0 0 23 23" aria-hidden="true">
                    <path fill="#f25022" d="M1 1h10v10H1z" />
                    <path fill="#7fba00" d="M12 1h10v10H12z" />
                    <path fill="#00a4ef" d="M1 12h10v10H1z" />
                    <path fill="#ffb900" d="M12 12h10v10H12z" />
                  </svg>
                )}
                {msLoading ? 'Opening Microsoft…' : 'Sign in with Microsoft'}
              </button>

              <p className="mt-3 text-center text-[11px] text-[var(--light)]">
                Use your Nearwork work account
              </p>

              {!showPassword ? (
                <button
                  type="button"
                  onClick={() => setShowPasswordLogin(true)}
                  className="mt-5 block w-full text-center text-xs text-[var(--light)] hover:text-[var(--green)]"
                >
                  Sign in with a password instead
                </button>
              ) : (
              <>
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--border)]" />
                <span className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">or</span>
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-500 text-[var(--mid)]">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@nearwork.co"
                    required
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--black)] placeholder-[var(--light)] outline-none transition-colors focus:border-[var(--green)] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-500 text-[var(--mid)]">
                    Password
                  </label>
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--black)] placeholder-[var(--light)] outline-none transition-colors focus:border-[var(--green)] focus:bg-white"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-600 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ background: 'var(--green)' }}
                >
                  {loading && <Spinner size="sm" />}
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <button
                onClick={() => {
                  setShowReset(true);
                  setResetEmail(email);
                  setError('');
                }}
                className="mt-4 block w-full text-center text-xs text-[var(--light)] hover:text-[var(--green)]"
              >
                Forgot password?
              </button>
              </>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setShowReset(false);
                  setResetSent(false);
                  setError('');
                }}
                className="mb-4 flex items-center gap-1 text-xs text-[var(--light)] hover:text-[var(--green)]"
              >
                ← Back to sign in
              </button>

              <h2 className="mb-2 text-base font-600 text-[var(--black)]">
                Reset password
              </h2>
              <p className="mb-6 text-xs text-[var(--light)]">
                We&apos;ll send a reset link to your email.
              </p>

              {resetSent ? (
                <div className="rounded-lg bg-green-50 px-3 py-3 text-xs font-500 text-green-700">
                  Reset email sent! Check your inbox.
                </div>
              ) : (
                <>
                  {error && (
                    <div className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-xs font-500 text-red-700">
                      {error}
                    </div>
                  )}
                  <form onSubmit={handleReset} className="space-y-4">
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@nearwork.co"
                      required
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--black)] placeholder-[var(--light)] outline-none transition-colors focus:border-[var(--green)] focus:bg-white"
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-600 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                      style={{ background: 'var(--green)' }}
                    >
                      {loading && <Spinner size="sm" />}
                      Send reset link
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
