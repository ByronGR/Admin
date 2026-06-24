import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = ['https://app.nearwork.co', 'https://admin.nearwork.co'];

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function GET(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'));
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get('orgId');
  if (!orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400, headers: cors });
  }

  try {
    const db = adminDb();
    const snap = await db.collection('org_invites').where('orgId', '==', orgId).get();
    const invites = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((inv: Record<string, unknown>) => inv.status === 'pending');
    return NextResponse.json({ invites }, { headers: cors });
  } catch (e) {
    console.error('[org-invites] query failed:', e);
    return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500, headers: cors });
  }
}
