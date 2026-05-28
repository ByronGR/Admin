'use client';

import { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { APP_VERSION } from '@/lib/version';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, updateDoc, serverTimestamp } from '@/lib/firebase';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/spinner';
import Link from 'next/link';
import { ExternalLink, Tag, FileText, Link as LinkIcon, Bell } from 'lucide-react';

// ─── Settings page ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [calendlyLink, setCalendlyLink] = useState(profile?.calendlyLink ?? '');
  const [savingCalendly, setSavingCalendly] = useState(false);

  async function saveCalendly() {
    if (!user) return;
    setSavingCalendly(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        calendlyLink: calendlyLink.trim(),
        updatedAt: serverTimestamp(),
      });
      showToast('Calendly link saved', 'success');
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSavingCalendly(false);
    }
  }

  return (
    <MainLayout>
      <div className="space-y-6 max-w-2xl">
        {/* Header */}
        <div>
          <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Settings</h1>
          <p className="mt-0.5 text-xs text-[var(--light)]">App configuration and your preferences.</p>
        </div>

        {/* Version */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="mb-4 text-sm font-600 text-[var(--black)]">Version</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
              <Tag className="h-4 w-4 text-[var(--green)]" />
              <span className="text-sm font-700 text-[var(--black)]">{APP_VERSION}</span>
            </div>
            <Link
              href="/changelog"
              className="flex items-center gap-1.5 text-xs text-[var(--green)] hover:underline"
            >
              <FileText className="h-3.5 w-3.5" />
              View changelog
            </Link>
          </div>
          <p className="mt-3 text-xs text-[var(--light)]">
            Format: MAJOR.MINOR.PATCH — Major = full rebuild; Minor = new features; Patch = fixes &amp; tweaks.
          </p>
        </div>

        {/* Calendly */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="mb-1 text-sm font-600 text-[var(--black)]">Your Calendly link</h2>
          <p className="mb-4 text-xs text-[var(--light)]">
            Shown to candidates when scheduling interviews. Only visible to candidates you are managing.
          </p>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
              <input
                type="url"
                value={calendlyLink}
                onChange={(e) => setCalendlyLink(e.target.value)}
                placeholder="https://calendly.com/your-name"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
            </div>
            <button
              onClick={saveCalendly}
              disabled={savingCalendly}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
              style={{ background: 'var(--green)' }}
            >
              {savingCalendly && <Spinner size="sm" />}
              Save
            </button>
          </div>
          {calendlyLink && (
            <a
              href={calendlyLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1.5 text-xs text-[var(--green)] hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Preview your Calendly
            </a>
          )}
        </div>

        {/* Notifications */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="h-4 w-4 text-[var(--light)]" />
            <h2 className="text-sm font-600 text-[var(--black)]">Notifications</h2>
          </div>
          <div className="space-y-3">
            {[
              { label: 'New candidate added to pipeline', desc: 'Get notified when a candidate is added to a pipeline you manage' },
              { label: 'Stage change', desc: 'Get notified when a candidate advances or is moved to a different stage' },
              { label: 'Assessment completed', desc: 'Get notified when a candidate completes their assessment' },
              { label: 'Opening approval required', desc: 'Get notified when an opening is submitted for review' },
            ].map(({ label, desc }) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-600 text-[var(--black)]">{label}</p>
                  <p className="text-[10px] text-[var(--light)]">{desc}</p>
                </div>
                <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                  <input type="checkbox" defaultChecked className="peer sr-only" />
                  <div className="h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--green)] peer-checked:after:translate-x-full" />
                </label>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-[var(--light)]">
            In-app notifications only. Email notifications will be available in a future update.
          </p>
        </div>

        {/* Invite-only notice */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="mb-1 text-sm font-600 text-[var(--black)]">Access control</h2>
          <p className="text-xs text-[var(--light)]">
            The admin is invite-only. Even users with @nearwork.co email addresses must receive an invitation
            to create an account. Manage invitations and team members on the{' '}
            <a href="/users" className="text-[var(--green)] hover:underline">Team page</a>.
          </p>
        </div>
      </div>
    </MainLayout>
  );
}
