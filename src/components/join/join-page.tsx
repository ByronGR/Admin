'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { PasswordInput } from '@/components/ui/password-input';
import type { StaffRole } from '@/lib/types';
import { STAFF_ROLE_LABELS } from '@/lib/types';

function JoinContent() {
  const params = useSearchParams();
  const token = params.get('token');

  type Stage = 'loading' | 'valid' | 'accepted' | 'expired' | 'invalid' | 'error';
  const [stage, setStage] = useState<Stage>('loading');
  const [invite, setInvite] = useState<{ email: string; role: StaffRole } | null>(null);
  const [form, setForm] = useState({ name: '', password: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) { setStage('invalid'); return; }
    verifyToken(token);
  }, [token]);

  async function verifyToken(t: string) {
    try {
      const res = await fetch('/api/staff-invite/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === 'valid') {
        setInvite({ email: data.email, role: data.role as StaffRole });
        setStage('valid');
      } else if (data.status === 'expired') {
        setStage('expired');
      } else if (data.status === 'error') {
        setStage('error');
      } else {
        setStage('invalid');
      }
    } catch {
      setStage('error');
    }
  }

  async function createAccount() {
    if (!invite || !token) return;
    if (!form.name.trim()) { setErrorMsg('Full name is required'); return; }
    if (form.password.length < 8) { setErrorMsg('Password must be at least 8 characters'); return; }
    if (form.password !== form.confirm) { setErrorMsg('Passwords do not match'); return; }

    setSaving(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/staff-invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: form.name.trim(), password: form.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setStage('accepted');
      } else {
        setErrorMsg(data.error || 'Could not create the account. Please try again.');
      }
    } catch {
      setErrorMsg('Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <span className="text-2xl font-800 tracking-tight" style={{ color: 'var(--green)' }}>
            nearwork
          </span>
          <span className="ml-2 rounded bg-white px-2 py-0.5 text-[10px] font-600 text-[var(--light)]">
            ADMIN
          </span>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-white p-8 shadow-sm">
          {stage === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Spinner />
              <p className="text-sm text-[var(--light)]">Verifying invite…</p>
            </div>
          )}

          {stage === 'invalid' && (
            <div className="text-center">
              <p className="text-base font-700 text-[var(--black)]">Invalid invite link</p>
              <p className="mt-1 text-sm text-[var(--light)]">
                This link is not valid. Please ask your administrator for a new invite.
              </p>
            </div>
          )}

          {stage === 'expired' && (
            <div className="text-center">
              <p className="text-base font-700 text-[var(--black)]">Invite expired</p>
              <p className="mt-1 text-sm text-[var(--light)]">
                This invite link has expired. Please ask your administrator for a new one.
              </p>
            </div>
          )}

          {stage === 'error' && (
            <div className="text-center">
              <p className="text-base font-700 text-[var(--black)]">Something went wrong</p>
              <p className="mt-1 text-sm text-[var(--light)]">
                Please try again or contact your administrator.
              </p>
            </div>
          )}

          {stage === 'accepted' && (
            <div className="text-center">
              <div
                className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                style={{ background: 'var(--green-soft)' }}
              >
                <svg className="h-6 w-6" style={{ color: 'var(--green)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-base font-700 text-[var(--black)]">Account created!</p>
              <p className="mt-1 text-sm text-[var(--light)]">
                Your account is ready. Click below to sign in.
              </p>
              <a
                href="/login"
                className="mt-5 block rounded-lg py-2.5 text-sm font-600 text-white"
                style={{ background: 'var(--green)' }}
              >
                Go to login
              </a>
            </div>
          )}

          {stage === 'valid' && invite && (
            <div>
              <p className="text-base font-700 text-[var(--black)]">You&apos;ve been invited</p>
              <p className="mt-1 text-sm text-[var(--light)]">
                Create your Nearwork Admin account as{' '}
                <span className="font-600 text-[var(--black)]">
                  {STAFF_ROLE_LABELS[invite.role]}
                </span>.
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    Email
                  </label>
                  <input
                    readOnly
                    value={invite.email}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--mid)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    Full name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Jane Doe"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    Password *
                  </label>
                  <PasswordInput
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Min. 8 characters"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    Confirm password *
                  </label>
                  <PasswordInput
                    value={form.confirm}
                    onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                    placeholder="Repeat password"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
                  />
                </div>

                {errorMsg && (
                  <p className="text-xs text-red-600">{errorMsg}</p>
                )}

                <button
                  onClick={createAccount}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-600 text-white disabled:opacity-60"
                  style={{ background: 'var(--green)' }}
                >
                  {saving && <Spinner size="sm" />}
                  Create account
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    }>
      <JoinContent />
    </Suspense>
  );
}
