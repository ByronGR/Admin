import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';

// ─── POST /api/stripe/webhook ───────────────────────────────────────────────────
// Receives Stripe billing events. We only care about a few event types that need
// to surface as an "action needed" flag on the matching organization (matched via
// Organization.stripeCustomerId) — everything else is acknowledged and ignored.
// All other billing data (totals, MRR, invoice history) is read live by the
// Billing tab via /api/stripe/customer, so this handler stays intentionally small.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function customerIdOf(obj: { customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null }): string | null {
  const c = obj.customer;
  if (!c) return null;
  return typeof c === 'string' ? c : c.id;
}

export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !webhookSecret) {
    return NextResponse.json({ ok: false, skipped: true, reason: 'not configured' });
  }

  const sig = req.headers.get('stripe-signature');
  const body = await req.text();

  const stripe = new Stripe(key);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig ?? '', webhookSecret);
  } catch (err) {
    return NextResponse.json({ ok: false, error: 'Invalid webhook signature' }, { status: 400 });
  }

  let note: string | null = null;
  let customerId: string | null = null;

  switch (event.type) {
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      customerId = customerIdOf(inv);
      const amount = ((inv.amount_due ?? 0) / 100).toLocaleString(undefined, {
        style: 'currency',
        currency: (inv.currency || 'usd').toUpperCase(),
      });
      note = `Stripe payment failed — invoice ${inv.number || inv.id} (${amount})`;
      break;
    }
    case 'invoice.payment_action_required': {
      const inv = event.data.object as Stripe.Invoice;
      customerId = customerIdOf(inv);
      note = `Stripe payment requires action — invoice ${inv.number || inv.id}`;
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      customerId = customerIdOf(sub);
      note = 'Stripe subscription cancelled';
      break;
    }
    default:
      return NextResponse.json({ ok: true, ignored: true });
  }

  if (!customerId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = adminDb();
  const snap = await db.collection('organizations').where('stripeCustomerId', '==', customerId).limit(1).get();
  if (snap.empty) {
    return NextResponse.json({ ok: true, matched: false });
  }

  await snap.docs[0].ref.update({
    actionNeeded: true,
    actionNote: note,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, matched: true });
}
