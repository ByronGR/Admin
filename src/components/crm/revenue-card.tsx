'use client';

// Revenue at a glance for one client: MRR, ARR, one-time revenue, and whether
// the relationship is recurring. Worked out from the org's service orders.

import { NW } from '@/components/nw/primitives';
import { Card, CardHead } from '@/components/nw/shell-ui';
import { revenueFrom, fmtUsd } from '@/lib/crm';
import type { ServiceOrder } from '@/lib/types';
import { Pill, Stat, LinkButton } from './ui';

export function RevenueBadge({ kind }: { kind: 'recurring' | 'one_time' | 'none' }) {
  if (kind === 'recurring') return <Pill fg={NW.teal700} bg={NW.teal50}>Recurring</Pill>;
  if (kind === 'one_time') return <Pill fg="#A16207" bg={NW.yellow50}>One-time</Pill>;
  return <Pill fg={NW.gray500} bg={NW.gray50}>No revenue yet</Pill>;
}

export function RevenueCard({ orders, loading, onOpenOrders }: { orders: ServiceOrder[]; loading: boolean; onOpenOrders: () => void }) {
  const r = revenueFrom(orders);
  const active = orders.filter((o) => o.status === 'active').length;
  return (
    <Card pad={18}>
      <CardHead icon="trending-up" title="Revenue" sub="From this client's service orders" action={<RevenueBadge kind={r.kind} />} />
      <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Stat label="MRR" value={loading ? '…' : fmtUsd(r.mrr)} color={r.mrr ? NW.teal700 : NW.gray400} />
        <Stat label="ARR" value={loading ? '…' : fmtUsd(r.arr)} color={r.arr ? NW.teal700 : NW.gray400} />
        <Stat label="One-time revenue" value={loading ? '…' : fmtUsd(r.oneTime)} color={r.oneTime ? NW.black : NW.gray400} />
        <div style={{ marginLeft: 'auto' }}>
          <LinkButton onClick={onOpenOrders}>{active ? `${active} active order${active === 1 ? '' : 's'} →` : 'Add a service order →'}</LinkButton>
        </div>
      </div>
    </Card>
  );
}
