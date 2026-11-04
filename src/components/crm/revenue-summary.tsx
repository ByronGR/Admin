'use client';

// Dashboard strip: Nearwork-wide MRR / ARR / one-time revenue from every
// client's service orders, how many clients are recurring vs one-time, and
// the MRR still open in the deal pipeline.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db, collection, getDocs } from '@/lib/firebase';
import { NW, Button } from '@/components/nw/primitives';
import { Card, CardHead } from '@/components/nw/shell-ui';
import { fmtUsd, revenueFrom } from '@/lib/crm';
import type { Deal, ServiceOrder } from '@/lib/types';
import { Stat } from './ui';

const OPEN = new Set(['Prospect', 'Meeting booked', 'Proposal', 'Contract sent']); // Proposal: pre-1.33 deals

export function RevenueSummary() {
  const router = useRouter();
  const [data, setData] = useState<{ mrr: number; arr: number; oneTime: number; recurring: number; oneTimeOnly: number; pipelineMrr: number } | null>(null);

  useEffect(() => {
    Promise.allSettled([getDocs(collection(db, 'serviceOrders')), getDocs(collection(db, 'deals'))]).then(([o, d]) => {
      const orders = o.status === 'fulfilled' ? o.value.docs.map((x) => x.data() as ServiceOrder) : [];
      const deals = d.status === 'fulfilled' ? d.value.docs.map((x) => x.data() as Deal) : [];
      const byOrg = new Map<string, ServiceOrder[]>();
      orders.forEach((x) => byOrg.set(x.orgId, [...(byOrg.get(x.orgId) || []), x]));
      let recurring = 0;
      let oneTimeOnly = 0;
      byOrg.forEach((list) => {
        const k = revenueFrom(list).kind;
        if (k === 'recurring') recurring += 1;
        else if (k === 'one_time') oneTimeOnly += 1;
      });
      const total = revenueFrom(orders);
      const pipelineMrr = deals.filter((x) => OPEN.has(x.stage)).reduce((n, x) => n + (Number(x.mrr) || 0), 0);
      setData({ mrr: total.mrr, arr: total.arr, oneTime: total.oneTime, recurring, oneTimeOnly, pipelineMrr });
    });
  }, []);

  const v = (n?: number) => (data ? fmtUsd(n) : '…');
  return (
    <Card pad={18}>
      <CardHead
        icon="trending-up"
        title="Recurring revenue"
        sub="From active service orders across all clients"
        action={<Button variant="secondary" size="sm" iconRight="arrow-right" onClick={() => router.push('/deals')}>Deals</Button>}
      />
      <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Stat label="MRR" value={v(data?.mrr)} color={NW.teal700} />
        <Stat label="ARR" value={v(data?.arr)} color={NW.teal700} />
        <Stat label="One-time revenue" value={v(data?.oneTime)} />
        <Stat label="Clients" value={data ? data.recurring : '…'} sub={data ? `recurring · ${data.oneTimeOnly} one-time only` : undefined} />
        <Stat label="Open pipeline MRR" value={v(data?.pipelineMrr)} sub="if every open deal closes" />
      </div>
    </Card>
  );
}
