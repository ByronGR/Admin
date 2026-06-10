import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── GET /api/stripe/customer?customerId=cus_xxx ───────────────────────────────
// Fetches live billing data for a Stripe customer linked to a Nearwork
// organization: lifetime amount paid, MRR, subscription status, and recent
// invoices. Read-only — used by the Billing tab on the org detail view.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INTERVAL_TO_MONTHLY: Record<string, number> = {
  day: 30,
  week: 4.345,
  month: 1,
  year: 1 / 12,
};

export async function GET(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, skipped: true, reason: 'not configured' });
  }

  const customerId = req.nextUrl.searchParams.get('customerId')?.trim();
  if (!customerId) {
    return NextResponse.json({ ok: false, error: 'customerId required' }, { status: 400 });
  }

  const stripe = new Stripe(key);

  try {
    const [customer, invoiceList, subscriptionList] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.invoices.list({ customer: customerId, limit: 12 }),
      stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 }),
    ]);

    if (customer.deleted) {
      return NextResponse.json({ ok: false, error: 'Stripe customer has been deleted' }, { status: 404 });
    }

    // ── Total paid: sum amount_paid across all paid invoices (paginate up to 5 pages) ──
    let totalPaid = 0;
    let currency = customer.currency || invoiceList.data[0]?.currency || 'usd';
    let page = invoiceList;
    for (let i = 0; i < 5; i++) {
      for (const inv of page.data) {
        if (inv.status === 'paid') {
          totalPaid += inv.amount_paid;
          currency = inv.currency;
        }
      }
      if (!page.has_more) break;
      const last = page.data[page.data.length - 1];
      page = await stripe.invoices.list({ customer: customerId, limit: 100, starting_after: last.id });
    }

    // ── MRR: sum active/trialing subscription items, normalized to monthly ──
    let mrr = 0;
    const subscriptions = subscriptionList.data.map((sub) => {
      const items = sub.items.data.map((item) => {
        const price = item.price;
        const unitAmount = price.unit_amount ?? 0;
        const quantity = item.quantity ?? 1;
        const amount = unitAmount * quantity;
        const interval = price.recurring?.interval ?? 'month';
        const intervalCount = price.recurring?.interval_count ?? 1;
        if (sub.status === 'active' || sub.status === 'trialing') {
          mrr += (amount / intervalCount) * (INTERVAL_TO_MONTHLY[interval] ?? 1);
        }
        return {
          name: price.nickname || (typeof price.product === 'string' ? price.product : '') || 'Subscription',
          amount,
          currency: price.currency,
          interval,
        };
      });
      return {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: sub.items.data[0]?.current_period_end
          ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
          : null,
        items,
      };
    });

    const invoices = invoiceList.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      amount: inv.status === 'paid' ? inv.amount_paid : inv.amount_due,
      currency: inv.currency,
      status: inv.status,
      created: new Date(inv.created * 1000).toISOString(),
      hostedInvoiceUrl: inv.hosted_invoice_url || null,
    }));

    return NextResponse.json({
      ok: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        currency: customer.currency,
        balance: customer.balance,
      },
      totalPaid: totalPaid / 100,
      mrr: mrr / 100,
      currency,
      subscriptions,
      invoices,
    });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      return NextResponse.json({ ok: false, error: `Stripe: ${err.message}` }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
