import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';

// ─── GET /api/company-lookup?website=<domain> ─────────────────────────────────
// Looks a company up by its website on People Data Labs (Company Enrichment)
// and returns the profile fields Atlas shows: size, HQ, industry, LinkedIn,
// funding stage, founded year. Read-only — the browser decides what to save.
//
// Free plan: 100 company matches a month; PDL charges per MATCH, so a lookup
// that finds nothing costs nothing. Key lives in Vercel as PDL_API_KEY.
//
// Staff-only: requires a valid Firebase ID token (Authorization: Bearer …) from a
// @nearwork.co account.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireStaff(req: Request): Promise<boolean> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return typeof decoded.email === 'string' && decoded.email.toLowerCase().endsWith('@nearwork.co');
  } catch {
    return false;
  }
}

// PDL returns lowercase text ("san francisco", "computer software").
const titleCase = (s?: string | null) =>
  (s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, 'and') || undefined;

// "series_b" → "Series B", "seed" → "Seed".
const fundingLabel = (s?: string | null) =>
  s ? s.split('_').map((w) => (w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ') : undefined;

const cleanDomain = (raw: string) =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

type PdlCompany = {
  status?: number;
  display_name?: string;
  name?: string;
  employee_count?: number;
  size?: string;
  industry?: string;
  website?: string;
  linkedin_url?: string;
  founded?: number;
  latest_funding_stage?: string;
  location?: { locality?: string; region?: string; country?: string; name?: string } | null;
  likelihood?: number;
};

export async function GET(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const key = process.env.PDL_API_KEY;
  if (!key) return NextResponse.json({ ok: false, reason: 'not_configured' });

  const website = cleanDomain(new URL(req.url).searchParams.get('website') || '');
  if (!website || !website.includes('.')) return NextResponse.json({ ok: false, reason: 'no_website' }, { status: 400 });

  let r: Response;
  try {
    r = await fetch(`https://api.peopledatalabs.com/v5/company/enrich?website=${encodeURIComponent(website)}`, {
      headers: { 'X-Api-Key': key },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ ok: false, reason: 'unreachable' }, { status: 502 });
  }

  // PDL: 404 no match, 402 out of monthly matches, 401 bad key, 429 rate limit.
  if (r.status === 404) return NextResponse.json({ ok: false, reason: 'not_found' });
  if (r.status === 402) return NextResponse.json({ ok: false, reason: 'out_of_credits' });
  if (r.status === 401 || r.status === 403) return NextResponse.json({ ok: false, reason: 'bad_key' });
  if (r.status === 429) return NextResponse.json({ ok: false, reason: 'rate_limited' });
  if (!r.ok) return NextResponse.json({ ok: false, reason: 'error', status: r.status }, { status: 502 });

  const c = (await r.json()) as PdlCompany;
  const loc = c.location || {};
  return NextResponse.json({
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
  });
}
