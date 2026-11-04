// ============================================================
// Company lookup (server only) — People Data Labs Company Enrichment.
//
// lookupCompany(): one website → the profile fields Atlas shows.
// fillOrgFromWeb(): looks an organization up and fills ONLY its empty fields,
//   recording what came from the web. Runs automatically when a company is
//   created in Admin or gets a website, and is what the Radar handoff will call.
//
// Free plan: 100 matches a month; PDL charges per MATCH, so a lookup that finds
// nothing costs nothing. Key: PDL_API_KEY in Vercel.
// ============================================================

import { adminDb } from '@/lib/firebase-admin';

export type LookupReason = 'not_configured' | 'no_website' | 'not_found' | 'out_of_credits' | 'bad_key' | 'rate_limited' | 'unreachable' | 'error';

export interface FoundCompany {
  name?: string;
  employeeCount?: number;
  sizeRange?: string;
  industry?: string;
  city?: string;
  region?: string;
  country?: string;
  linkedin?: string;
  website?: string;
  founded?: number;
  fundingStage?: string;
  likelihood?: number;
}

// The organization fields a lookup may fill, in display order.
export const LOOKUP_FIELDS = ['employeeCount', 'sizeRange', 'industry', 'city', 'region', 'country', 'linkedin', 'fundingStage', 'founded'] as const;

// PDL returns lowercase text ("san francisco", "computer software").
const titleCase = (s?: string | null) =>
  (s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, 'and') || undefined;

// "series_b" → "Series B", "seed" → "Seed".
const fundingLabel = (s?: string | null) =>
  s ? s.split('_').map((w) => (w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ') : undefined;

export const cleanDomain = (raw: string) =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

type PdlCompany = {
  display_name?: string;
  name?: string;
  employee_count?: number;
  size?: string;
  industry?: string;
  website?: string;
  linkedin_url?: string;
  founded?: number;
  latest_funding_stage?: string;
  location?: { locality?: string; region?: string; country?: string } | null;
  likelihood?: number;
};

export async function lookupCompany(rawWebsite: string): Promise<{ ok: true; company: FoundCompany } | { ok: false; reason: LookupReason }> {
  const key = process.env.PDL_API_KEY;
  if (!key) return { ok: false, reason: 'not_configured' };
  const website = cleanDomain(rawWebsite || '');
  if (!website || !website.includes('.')) return { ok: false, reason: 'no_website' };

  let r: Response;
  try {
    r = await fetch(`https://api.peopledatalabs.com/v5/company/enrich?website=${encodeURIComponent(website)}`, {
      headers: { 'X-Api-Key': key },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  // PDL: 404 no match, 402 out of monthly matches, 401 bad key, 429 rate limit.
  console.log(`[company-lookup] ${website} -> PDL ${r.status}`);
  if (r.status === 404) return { ok: false, reason: 'not_found' };
  if (r.status === 402) return { ok: false, reason: 'out_of_credits' };
  if (r.status === 401 || r.status === 403) return { ok: false, reason: 'bad_key' };
  if (r.status === 429) return { ok: false, reason: 'rate_limited' };
  if (!r.ok) return { ok: false, reason: 'error' };

  const c = (await r.json()) as PdlCompany;
  const loc = c.location || {};
  return {
    ok: true,
    company: {
      name: c.display_name || titleCase(c.name),
      employeeCount: typeof c.employee_count === 'number' ? c.employee_count : undefined,
      sizeRange: c.size || undefined,
      industry: titleCase(c.industry),
      city: titleCase(loc.locality),
      region: titleCase(loc.region),
      country: titleCase(loc.country),
      linkedin: c.linkedin_url ? (c.linkedin_url.startsWith('http') ? c.linkedin_url : `https://www.${c.linkedin_url}`) : undefined,
      website: c.website || website,
      founded: c.founded || undefined,
      fundingStage: fundingLabel(c.latest_funding_stage),
      likelihood: c.likelihood,
    },
  };
}

const isEmpty = (v: unknown) => v == null || v === '';

// Look an organization up and fill only its empty fields. Skips the paid call
// when this exact website was already looked up, unless `force` is set.
export async function fillOrgFromWeb(orgId: string, opts: { force?: boolean } = {}) {
  const ref = adminDb().collection('organizations').doc(orgId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false as const, reason: 'error' as const };
  const org = snap.data() as Record<string, unknown> & { website?: string; lastLookup?: { website?: string }; enrichedFields?: string[] };
  const website = cleanDomain(org.website || '');
  if (!website) return { ok: false as const, reason: 'no_website' as const };
  if (!opts.force && org.lastLookup?.website === website) return { ok: true as const, skipped: true, filled: [] as string[] };

  const res = await lookupCompany(website);
  const at = new Date().toISOString();
  if (!res.ok) {
    // Remember a definite "no match" so the same website isn't charged/retried.
    if (res.reason === 'not_found') await ref.update({ lastLookup: { at, result: 'not_found', website } });
    return res;
  }

  const patch: Record<string, unknown> = {};
  for (const k of LOOKUP_FIELDS) {
    const v = res.company[k];
    if (!isEmpty(v) && isEmpty(org[k])) patch[k] = v;
  }
  const filled = Object.keys(patch);
  await ref.update({
    ...patch,
    lastLookup: { at, result: 'found', website },
    ...(filled.length ? { enrichedAt: at, enrichedFields: Array.from(new Set([...(org.enrichedFields || []), ...filled])) } : {}),
  });
  return { ok: true as const, skipped: false, filled };
}
