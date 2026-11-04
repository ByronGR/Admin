import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { lookupCompany, fillOrgFromWeb } from '@/lib/company-lookup';

// ─── /api/company-lookup ──────────────────────────────────────────────────────
// GET  ?website=<domain>  → what People Data Labs knows (the "Fill from web"
//                           window shows it next to what's saved; nothing written).
// POST { orgId, force? }  → look the organization up and fill ONLY its empty
//                           fields. Called automatically when a company is
//                           created or gets a website.
//
// Staff-only: requires a valid Firebase ID token (Authorization: Bearer …) from a
// @nearwork.co account. Needs PDL_API_KEY in Vercel.

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

export async function GET(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const res = await lookupCompany(new URL(req.url).searchParams.get('website') || '');
  return NextResponse.json(res);
}

export async function POST(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { orgId?: string; force?: boolean };
  if (!body.orgId) return NextResponse.json({ ok: false, reason: 'error' }, { status: 400 });
  try {
    return NextResponse.json(await fillOrgFromWeb(body.orgId, { force: !!body.force }));
  } catch (e) {
    console.error('[company-lookup] fill failed', e);
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
