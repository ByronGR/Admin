import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { aiDailyCap, hasOwnKey, type AIFeature } from '@/lib/ai-usage';

// ── /api/ai-usage ─────────────────────────────────────────────────────────────
// What every Claude call in Admin cost, by feature. Read-only.
//
// The number that matters here isn't the money — a month of vetting is about a
// dollar. It's the CALL COUNT: a call wired to the wrong trigger fires on every
// candidate instead of the few you interview, and at these prices that shows up
// as a count long before it shows up on an invoice.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEATURES: AIFeature[] = ['cv', 'sourcing', 'vetting'];

export async function GET(req: Request) {
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    if (!String(decoded.email || '').toLowerCase().endsWith('@nearwork.co')) {
      return NextResponse.json({ error: 'Staff only' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const db = adminDb();
  const today = new Date().toISOString().slice(0, 10);

  // Last 30 days, so a trigger that started misfiring is visible as a shape
  // rather than a single day's total.
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }

  const snaps = await Promise.all(days.map((d) => db.collection('aiUsage').doc(d).get().catch(() => null)));
  const daily = days.map((d, i) => {
    const data = (snaps[i]?.exists ? snaps[i]!.data() : {}) as Record<string, number>;
    const row: Record<string, number | string> = { day: d };
    FEATURES.forEach((f) => {
      row[`${f}_calls`] = Number(data[`${f}_calls`] || 0);
      row[`${f}_usd`] = Number(data[`${f}_microUsd`] || 0) / 1e6;
    });
    return row;
  });

  const month = new Date().toISOString().slice(0, 7);
  const mSnap = await db.collection('aiUsageMonthly').doc(month).get().catch(() => null);
  const mData = (mSnap?.exists ? mSnap.data() : {}) as Record<string, number>;

  return NextResponse.json({
    today,
    month,
    features: FEATURES.map((f) => ({
      feature: f,
      ownKey: hasOwnKey(f),
      dailyCap: aiDailyCap(f),
      todayCalls: Number(daily[daily.length - 1][`${f}_calls`] || 0),
      monthCalls: Number(mData[`${f}_calls`] || 0),
      monthUsd: Number(mData[`${f}_microUsd`] || 0) / 1e6,
    })),
    daily,
  });
}
