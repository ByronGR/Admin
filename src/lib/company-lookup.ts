// ============================================================
// Company lookup (server only) — People Data Labs Company Enrichment.
//
// lookupCompany(): a website (or, failing that, a name + country) → the
//   profile fields Atlas shows.
// fillOrgFromWeb(): looks an organization up and fills ONLY its empty fields,
//   recording what came from the web. Runs automatically for companies that
//   have never been looked up, when one is created, or when its website
//   changes; it is also what the Radar handoff will call.
//
// Free plan: 100 matches a month; PDL charges per MATCH, so a lookup that finds
// nothing costs nothing. Key: PDL_API_KEY in Vercel. Everything requested here
// is in PDL's Base bundle (revenue estimates are premium, so not used).
// ============================================================

import { adminDb } from '@/lib/firebase-admin';

export type LookupReason = 'not_configured' | 'no_website' | 'not_found' | 'out_of_credits' | 'bad_key' | 'rate_limited' | 'unreachable' | 'error';

export interface FoundCompany {
  name?: string;
  website?: string;
  employeeCount?: number;
  sizeRange?: string;
  industry?: string;
  city?: string;
  region?: string;
  country?: string;
  linkedin?: string;
  twitter?: string;
  facebook?: string;
  founded?: number;
  fundingStage?: string;
  totalFunding?: number;
  lastFundingDate?: string;
  fundingRounds?: number;
  description?: string;
  headline?: string;
  companyType?: string;
  tags?: string[];
  ticker?: string;
  pdlId?: string;
  likelihood?: number;
}

// The organization fields a lookup may fill.
export const LOOKUP_FIELDS = [
  'website', 'description', 'headline', 'employeeCount', 'sizeRange', 'industry', 'city', 'region', 'country',
  'companyType', 'founded', 'fundingStage', 'totalFunding', 'lastFundingDate', 'fundingRounds',
  'linkedin', 'twitter', 'facebook', 'tags', 'ticker', 'pdlId',
] as const;

// PDL returns lowercase text ("san francisco", "computer software").
const titleCase = (s?: string | null) =>
  (s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, 'and') || undefined;
const sentence = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : undefined);
// "series_b" → "Series B", "seed" → "Seed".
const fundingLabel = (s?: string | null) =>
  s ? s.split('_').map((w) => (w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ') : undefined;
const url = (s?: string | null) => (s ? (s.startsWith('http') ? s : `https://www.${s.replace(/^www\./, '')}`) : undefined);

export const cleanDomain = (raw: string) =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

type PdlCompany = {
  id?: string;
  display_name?: string;
  name?: string;
  employee_count?: number;
  size?: string;
  industry?: string;
  website?: string;
  linkedin_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  founded?: number;
  latest_funding_stage?: string;
  total_funding_raised?: number;
  last_funding_date?: string;
  number_funding_rounds?: number;
  summary?: string;
  headline?: string;
  type?: string;
  tags?: string[];
  ticker?: string;
  location?: { locality?: string; region?: string; country?: string } | null;
  likelihood?: number;
};

export interface LookupInput { website?: string; name?: string; country?: string }

export async function lookupCompany(input: LookupInput): Promise<{ ok: true; company: FoundCompany; by: 'website' | 'name' } | { ok: false; reason: LookupReason }> {
  const key = process.env.PDL_API_KEY;
  if (!key) return { ok: false, reason: 'not_configured' };
  const website = cleanDomain(input.website || '');
  const byWebsite = !!website && website.includes('.');
  const name = (input.name || '').trim();
  if (!byWebsite && !name) return { ok: false, reason: 'no_website' };

  // A website is an exact match. A name alone is fuzzier, so ask PDL for a
  // confident match only (likelihood 5+) and narrow by country when known.
  const params = new URLSearchParams();
  if (byWebsite) params.set('website', website);
  else {
    params.set('name', name);
    if (input.country) params.set('country', input.country);
    params.set('min_likelihood', '5');
  }

  let r: Response;
  try {
    r = await fetch(`https://api.peopledatalabs.com/v5/company/enrich?${params}`, {
      headers: { 'X-Api-Key': key },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  // PDL: 404 no match, 402 out of monthly matches, 401 bad key, 429 rate limit.
  console.log(`[company-lookup] ${byWebsite ? website : `name "${name}"`} -> PDL ${r.status}`);
  if (r.status === 404) return { ok: false, reason: 'not_found' };
  if (r.status === 402) return { ok: false, reason: 'out_of_credits' };
  if (r.status === 401 || r.status === 403) return { ok: false, reason: 'bad_key' };
  if (r.status === 429) return { ok: false, reason: 'rate_limited' };
  if (!r.ok) return { ok: false, reason: 'error' };

  const c = (await r.json()) as PdlCompany;
  const loc = c.location || {};
  return {
    ok: true,
    by: byWebsite ? 'website' : 'name',
    company: {
      name: c.display_name || titleCase(c.name),
      website: c.website || (byWebsite ? website : undefined),
      employeeCount: typeof c.employee_count === 'number' ? c.employee_count : undefined,
      sizeRange: c.size || undefined,
      industry: titleCase(c.industry),
      city: titleCase(loc.locality),
      region: titleCase(loc.region),
      country: titleCase(loc.country),
      linkedin: url(c.linkedin_url),
      twitter: url(c.twitter_url),
      facebook: url(c.facebook_url),
      founded: c.founded || undefined,
      fundingStage: fundingLabel(c.latest_funding_stage),
      totalFunding: c.total_funding_raised || undefined,
      lastFundingDate: c.last_funding_date || undefined,
      fundingRounds: c.number_funding_rounds || undefined,
      description: sentence(c.summary),
      headline: sentence(c.headline),
      companyType: titleCase(c.type),
      tags: c.tags?.length ? c.tags.slice(0, 12).map((t) => titleCase(t) as string) : undefined,
      ticker: c.ticker || undefined,
      pdlId: c.id || undefined,
      likelihood: c.likelihood,
    },
  };
}

const isEmpty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

// Look an organization up and fill only its empty fields. Skips the paid call
// when this company was already looked up the same way, unless `force` is set.
export async function fillOrgFromWeb(orgId: string, opts: { force?: boolean } = {}) {
  const ref = adminDb().collection('organizations').doc(orgId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false as const, reason: 'error' as const };
  const org = snap.data() as Record<string, unknown> & {
    name?: string; website?: string; country?: string; enrichedFields?: string[];
    lastLookup?: { website?: string; by?: string };
  };
  const website = cleanDomain(org.website || '');
  const lookedUp = org.lastLookup;
  // Same website as last time, or no website and already tried by name: nothing new to learn.
  if (!opts.force && lookedUp && (website ? lookedUp.website === website : lookedUp.by === 'name')) {
    return { ok: true as const, skipped: true, filled: [] as string[] };
  }

  const res = await lookupCompany({ website, name: org.name, country: org.country });
  const at = new Date().toISOString();
  const by: 'website' | 'name' = website ? 'website' : 'name';
  if (!res.ok) {
    // Remember a definite "no match" so the same company isn't retried.
    if (res.reason === 'not_found') await ref.update({ lastLookup: { at, result: 'not_found', website: website || null, by } });
    return res;
  }

  const patch: Record<string, unknown> = {};
  for (const k of LOOKUP_FIELDS) {
    const v = res.company[k];
    if (!isEmpty(v) && isEmpty(org[k])) patch[k] = v;
  }
  const filled = Object.keys(patch).filter((k) => k !== 'pdlId');
  await ref.update({
    ...patch,
    lastLookup: { at, result: 'found', website: (patch.website as string | undefined) ? cleanDomain(patch.website as string) : website || null, by: res.by },
    ...(filled.length ? { enrichedAt: at, enrichedFields: Array.from(new Set([...(org.enrichedFields || []), ...filled])) } : {}),
  });
  return { ok: true as const, skipped: false, filled };
}
