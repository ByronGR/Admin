'use client';

import { MainLayout } from '@/components/layout/main-layout';
import { CHANGELOG } from '@/lib/version';

// ─── Changelog page ───────────────────────────────────────────────────────────

export default function ChangelogPage() {
  return (
    <MainLayout>
      <div className="max-w-2xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Changelog</h1>
          <p className="mt-0.5 text-xs text-[var(--light)]">Every release, newest first. Internal use only.</p>
        </div>

        {/* Releases */}
        <div className="space-y-5">
          {CHANGELOG.map((release) => (
            <div key={release.version} className="rounded-2xl border border-[var(--border)] bg-white p-6">
              {/* Version + date */}
              <div className="mb-4 flex items-center gap-3">
                <span className="rounded-full bg-[var(--green)] px-2.5 py-0.5 text-xs font-700 text-white">
                  v{release.version}
                </span>
                <span className="text-xs text-[var(--light)]">{release.date}</span>
              </div>

              {/* Sections */}
              <div className="space-y-4">
                {release.sections.map((section) => (
                  <div key={section.title}>
                    <p className={`mb-2 text-[10px] font-700 uppercase tracking-wider ${
                      section.title === 'Added' ? 'text-green-600' :
                      section.title === 'Fixed' ? 'text-amber-600' :
                      section.title === 'Removed' ? 'text-red-500' :
                      'text-[var(--light)]'
                    }`}>
                      {section.title}
                    </p>
                    <ul className="space-y-1.5">
                      {section.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-[var(--mid)]">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--border)]" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </MainLayout>
  );
}
