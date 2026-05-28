// ─── App version ──────────────────────────────────────────────────────────────
// Bump this on every release. Format: MAJOR.MINOR.PATCH
// MAJOR = full rebuild / new product
// MINOR = new feature sprint completed
// PATCH = bug fixes and tweaks

export const APP_VERSION = '0.1.3';

// ─── Changelog data ───────────────────────────────────────────────────────────
// Add new releases at the TOP. Never delete old entries.

interface ChangelogSection {
  title: 'Added' | 'Fixed' | 'Removed' | 'Technical';
  items: string[];
}

interface ChangelogRelease {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '0.1.3',
    date: '2026-05-28',
    sections: [
      {
        title: 'Added',
        items: [
          'Delete for organizations, openings, pipelines, and assessment records — inline confirm on every item, no extra modal',
          'Auto-create linked pipeline when a new opening is saved — pipeline code shown in success toast',
          'Settings page at /settings with version display and Calendly placeholder',
          'Changelog page at /changelog — internal only, requires login',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'FX calculator always empty — Frankfurter API does not include COP. Switched to @fawazahmed0/currency-api CDN (free, no key, full COP + 90-day history)',
        ],
      },
    ],
  },
  {
    version: '0.1.2',
    date: '2026-05-28',
    sections: [
      {
        title: 'Fixed',
        items: [
          '404 on page refresh — added cleanUrls: true to vercel.json so /dashboard correctly serves dashboard.html',
          'routes-manifest.json not found on Vercel — switched framework from "nextjs" to null; app served as plain static site from out/',
        ],
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-05-28',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Firestore orderBy silently excluded documents without a createdAt field — removed from all 5 collection queries and replaced with client-side sortByTimestamp()',
          'Dashboard users query filtered by source == admin.nearwork.co, hiding staff created before that field existed — filter removed',
          'Added sortByTimestamp<T>() utility (handles Firestore Timestamps, ISO strings, epoch numbers, and missing fields gracefully)',
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-05-27',
    sections: [
      {
        title: 'Added',
        items: [
          'Full Next.js 16 + TypeScript + Tailwind CSS v4 rebuild from single-page HTML admin',
          'Firebase Authentication restricted to @nearwork.co domain',
          'Dashboard with live Firestore stats and report builder',
          'Organizations — create, list, detail, edit, delete',
          'Openings — create, list, detail (with org linking), edit, delete',
          'Pipeline — real-time kanban board with drag-and-drop (7 stages)',
          'Candidates — list, search, filter',
          'Assessments — results table and question bank',
          'Hired / Placements page',
          'Salary Rates — USD/COP FX calculator with NCR formula and 90-day sparkline',
          'Kickoff brief — 10-section form with auto-save and audit trail',
          'Login page with forgot-password flow',
        ],
      },
      {
        title: 'Technical',
        items: [
          'output: export — zero Next.js serverless functions; stays within Vercel Hobby 12-function limit',
          '12 existing /api/ serverless functions preserved untouched',
          'TypeScript strict mode with zero tsc --noEmit errors',
        ],
      },
    ],
  },
];
