// ─── Utility helpers ──────────────────────────────────────────────────────────

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Timestamp } from '@/lib/types';

/** Merge Tailwind class names (used by shadcn/ui components) */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Display label for a candidate's location.
 * Colombia → "City, Department"; any other country → just the country name.
 * Falls back to whatever location text exists.
 */
export function candidateLocationLabel(c: {
  country?: string; locationCountry?: string;
  city?: string; locationCity?: string;
  department?: string; locationDepartment?: string;
  location?: string;
}): string {
  const country = (c.locationCountry || c.country || '').trim();
  if (country && country.toLowerCase() !== 'colombia') return country;
  const city = titleCasePlace((c.city || c.locationCity || '').trim());
  const dept = (c.department || c.locationDepartment || '').trim();
  return [city, dept].filter(Boolean).join(', ') || (c.location || '').trim();
}

/** Capitalize each word (first letter up, rest down). For places like "cali" → "Cali". */
export function titleCasePlace(s: string): string {
  return String(s || '').replace(/\S+/g, (w) => w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase());
}

/**
 * Tidy a person's name for display: any word typed in ALL CAPS is converted to
 * Title case ("SEBASTIAN" → "Sebastian"); words that already have mixed case
 * ("McDonald", "José") are left untouched.
 */
export function properName(s?: string): string {
  return String(s || '')
    .split(/(\s+)/)
    .map((w) => {
      if (!w || /^\s+$/.test(w)) return w;
      const letters = w.replace(/[^\p{L}]/gu, '');
      const isAllCaps = letters && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
      return isAllCaps ? w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase() : w;
    })
    .join('');
}

/** Format a Firestore Timestamp or ISO string into a human-readable date */
export function fmtDate(
  val: Timestamp | string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
): string {
  if (!val) return '—';
  const d =
    typeof val === 'string'
      ? new Date(val)
      : val.toDate?.() ?? new Date(val.seconds * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', opts);
}

/** Format a Firestore Timestamp or ISO string into a time string */
export function fmtTime(val: Timestamp | string | null | undefined): string {
  if (!val) return '—';
  const d =
    typeof val === 'string'
      ? new Date(val)
      : val.toDate?.() ?? new Date(val.seconds * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/** Format relative time (e.g. "2 hours ago") */
export function fmtRelative(val: Timestamp | string | null | undefined): string {
  if (!val) return '—';
  const d =
    typeof val === 'string'
      ? new Date(val)
      : val.toDate?.() ?? new Date(val.seconds * 1000);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(val);
}

/** Format a number as currency, e.g. "$1,500 USD" or "$1.500.000 COP" */
export function fmtCurrency(
  amount: number | null | undefined,
  currency = 'USD'
): string {
  if (amount == null) return '—';
  const code = currency.toUpperCase();
  const locale = code === 'COP' ? 'es-CO' : 'en-US';
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
  return `$${formatted} ${code}`;
}

/** Format a salary range as currency, e.g. "$1,500 – $2,000 USD" or "$1.500.000 COP" */
export function fmtCurrencyRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency = 'USD'
): string {
  if (min == null && max == null) return '—';
  const code = currency.toUpperCase();
  const locale = code === 'COP' ? 'es-CO' : 'en-US';
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  if (max == null || max === min) return `$${fmt((min ?? max)!)} ${code}`;
  if (min == null) return `$${fmt(max)} ${code}`;
  return `$${fmt(min)} – $${fmt(max)} ${code}`;
}

/** Format a number with commas */
export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

/** Generate a pipeline code like PL-8421 */
export function generateCode(prefix = 'PL'): string {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// Crockford-style alphabet: no I, L, O, U or 0/1 so codes are unambiguous when
// read aloud, typed, or pasted into a URL.
const CANDIDATE_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/**
 * Generate a short, human-readable candidate ID like "K7M2PX". This becomes the
 * candidate's Firestore document ID, so /candidates/<id> and the matching
 * /hired/<id> placement share one ID for the same person. Callers should check
 * for collisions before writing (the keyspace is ~30^6 so collisions are rare).
 */
export function generateCandidateId(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CANDIDATE_ID_ALPHABET[Math.floor(Math.random() * CANDIDATE_ID_ALPHABET.length)];
  }
  return out;
}

/** Capitalize first letter */
export function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Convert snake_case to Title Case */
export function snakeToTitle(s: string): string {
  return s
    .split('_')
    .map((w) => capitalize(w))
    .join(' ');
}

/** Truncate a string with ellipsis */
export function truncate(s: string, max = 60): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Extract initials from a name */
export function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** Debounce a function */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Color for pipeline stage chips */
export const STAGE_COLORS: Record<string, string> = {
  sourcing: 'bg-gray-100 text-gray-600',
  screening: 'bg-blue-100 text-blue-700',
  assessment: 'bg-violet-100 text-violet-700',
  interview_1: 'bg-indigo-100 text-indigo-700',
  interview_2: 'bg-purple-100 text-purple-700',
  interview_3: 'bg-fuchsia-100 text-fuchsia-700',
  technical: 'bg-orange-100 text-orange-700',
  offer: 'bg-amber-100 text-amber-700',
  hired: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
};

/** Color for status badges */
export const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  closed: 'bg-gray-100 text-gray-600',
  filled: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-600',
  open: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  submitted: 'bg-blue-100 text-blue-700',
  changes_requested: 'bg-amber-100 text-amber-700',
};

/** NCR formula: max(2500, weightedAvg - 250) */
export function calcNCR(weightedAvgCOP: number): number {
  const usdCOP = weightedAvgCOP;
  return Math.max(2500, usdCOP - 250);
}

/** Clamp a number between min and max */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Generate a short, human-safe ID from a charset that omits visually
 * confusable characters: 0 O, 1 I L.
 * Safe chars: 2-9 + A-Z minus (O I L) = 32 characters.
 * Example output: 'A7KM2P'
 */
const SAFE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function genSafeId(length = 6): string {
  let id = '';
  const arr = new Uint8Array(length);
  if (typeof window !== 'undefined') {
    window.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < length; i++) {
    id += SAFE_CHARS[arr[i] % SAFE_CHARS.length];
  }
  return id;
}

/**
 * Sort an array of Firestore docs by a timestamp field (newest first by default).
 * Works with Firestore Timestamps, { seconds, nanoseconds } objects, ISO strings,
 * and epoch numbers — so docs that lack the field simply sort to the bottom.
 */
export function sortByTimestamp<T>(
  arr: T[],
  field: keyof T,
  direction: 'asc' | 'desc' = 'desc'
): T[] {
  const toMs = (v: unknown): number => {
    if (!v) return 0;
    if (typeof v === 'object' && v !== null && 'toMillis' in v)
      return (v as { toMillis(): number }).toMillis();
    if (typeof v === 'object' && v !== null && 'seconds' in v)
      return (v as { seconds: number }).seconds * 1000;
    if (typeof v === 'string' || typeof v === 'number') return new Date(v).getTime();
    return 0;
  };
  return [...arr].sort((a, b) =>
    direction === 'desc'
      ? toMs(b[field]) - toMs(a[field])
      : toMs(a[field]) - toMs(b[field])
  );
}

/** Parse a string to a safe number, or fallback */
export function parseNum(val: string | number | undefined, fallback = 0): number {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}
