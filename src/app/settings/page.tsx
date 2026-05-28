'use client';

import { MainLayout } from '@/components/layout/main-layout';
import { APP_VERSION } from '@/lib/version';
import Link from 'next/link';
import { ExternalLink, Tag, FileText } from 'lucide-react';

// ─── Settings page ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <MainLayout>
      <div className="space-y-6 max-w-2xl">
        {/* Header */}
        <div>
          <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Settings</h1>
          <p className="mt-0.5 text-xs text-[var(--light)]">App configuration and information.</p>
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

        {/* Notifications — placeholder for Sprint 1 */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="mb-1 text-sm font-600 text-[var(--black)]">Notifications</h2>
          <p className="text-xs text-[var(--light)]">Notification preferences will be available in a future update.</p>
        </div>

        {/* Calendly — placeholder for Sprint 1 */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="mb-1 text-sm font-600 text-[var(--black)]">Calendly link</h2>
          <p className="mb-3 text-xs text-[var(--light)]">
            Your Calendly link will be shown to candidates when scheduling interviews. Configure it in your profile.
          </p>
          <a
            href="https://calendly.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-[var(--green)] hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Calendly
          </a>
        </div>
      </div>
    </MainLayout>
  );
}
