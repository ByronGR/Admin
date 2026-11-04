'use client';

// ============================================================
// Service orders — what a client bought, and how it bills.
// Active monthly orders add up to MRR (ARR = MRR × 12); one-time orders
// (placement fees, credits) count as one-time revenue. Firestore: serviceOrders.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  db, collection, getDocs, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from '@/lib/firebase';
import { NW, Button } from '@/components/nw/primitives';
import { Card, CardHead, Table, Th, Td, TableRow } from '@/components/nw/shell-ui';
import { Modal } from '@/components/ui/modal';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { useToast } from '@/components/ui/toast';
import { actorName, fmtUsd, orderTotal, revenueFrom } from '@/lib/crm';
import {
  SERVICE_LABELS, SERVICE_ORDER_STATUSES,
  type BillingType, type Organization, type ServiceKind, type ServiceOrder, type ServiceOrderStatus,
} from '@/lib/types';
import { RevenueBadge } from './revenue-card';
import { crmField, Field, Pill, Empty, Stat, saveErrorMessage } from './ui';

const STATUS_STYLE: Record<ServiceOrderStatus, { fg: string; bg: string; label: string }> = {
  draft: { fg: NW.gray600, bg: NW.gray50, label: 'Draft' },
  active: { fg: NW.teal700, bg: NW.teal50, label: 'Active' },
  paused: { fg: '#A16207', bg: NW.yellow50, label: 'Paused' },
  ended: { fg: NW.gray500, bg: NW.gray50, label: 'Ended' },
};

export function useServiceOrders(orgId: string) {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, 'serviceOrders'), where('orgId', '==', orgId)));
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ServiceOrder);
      list.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
      setOrders(list);
    } catch (e) {
      console.error('[serviceOrders] load failed', e);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);
  // Load from Firestore on mount and when the company changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);
  return { orders, loading, reload };
}

export function ServiceOrdersTab({ org, orders, loading, reload }: { org: Organization; orders: ServiceOrder[]; loading: boolean; reload: () => void }) {
  const [editing, setEditing] = useState<ServiceOrder | 'new' | null>(null);
  const r = revenueFrom(orders);

  return (
    <div style={{ marginTop: 20 }}>
      <Card pad={18}>
        <CardHead
          icon="receipt-text"
          title="Service orders"
          sub="What this client buys. Monthly orders make up MRR."
          action={<Button size="sm" icon="plus" onClick={() => setEditing('new')}>New order</Button>}
        />
        <div style={{ display: 'flex', gap: 34, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
          <Stat label="MRR" value={fmtUsd(r.mrr)} color={r.mrr ? NW.teal700 : NW.gray400} />
          <Stat label="ARR" value={fmtUsd(r.arr)} color={r.arr ? NW.teal700 : NW.gray400} />
          <Stat label="One-time revenue" value={fmtUsd(r.oneTime)} color={r.oneTime ? NW.black : NW.gray400} />
          <div style={{ marginLeft: 'auto' }}><RevenueBadge kind={r.kind} /></div>
        </div>
        {loading ? (
          <div style={{ fontSize: 13, color: NW.gray500, padding: 12 }}>Loading…</div>
        ) : orders.length === 0 ? (
          <Empty icon="receipt-text" title="No service orders yet" sub="Add what the client bought — a managed team billed monthly, a direct-hire fee, Vera credits — so MRR and ARR stay accurate." />
        ) : (
          <Table>
            <thead>
              <tr><Th>Service</Th><Th>Billing</Th><Th align="right">Amount</Th><Th>Start</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const s = STATUS_STYLE[o.status] || STATUS_STYLE.draft;
                const qty = Number(o.quantity) || 1;
                return (
                  <TableRow key={o.id} onClick={() => setEditing(o)}>
                    <Td>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{SERVICE_LABELS[o.service] || o.service}</div>
                      {o.description && <div style={{ fontSize: 12, color: NW.gray500 }}>{o.description}</div>}
                    </Td>
                    <Td>{o.billing === 'monthly' ? 'Monthly' : 'One-time'}</Td>
                    <Td align="right">
                      <div style={{ fontWeight: 600 }}>{fmtUsd(orderTotal(o))}{o.billing === 'monthly' ? '/mo' : ''}</div>
                      {qty > 1 && <div style={{ fontSize: 11.5, color: NW.gray500 }}>{qty} × {fmtUsd(o.amount)}</div>}
                    </Td>
                    <Td>{o.startDate || '—'}</Td>
                    <Td><Pill fg={s.fg} bg={s.bg}>{s.label}</Pill></Td>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && (
        <OrderModal
          org={org}
          order={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

// Monthly by default for ongoing services, one-time for fees and credits.
const DEFAULT_BILLING: Record<ServiceKind, BillingType> = {
  managed: 'monthly', eor: 'monthly', spp: 'monthly', direct_hire: 'one_time',
  sourcing: 'one_time', vera_credits: 'one_time', other: 'monthly',
};

function OrderModal({ org, order, onClose, onDone }: { org: Organization; order: ServiceOrder | null; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [f, setF] = useState({
    service: (order?.service ?? 'managed') as ServiceKind,
    billing: (order?.billing ?? 'monthly') as BillingType,
    description: order?.description ?? '',
    amount: order ? String(order.amount) : '',
    quantity: order?.quantity ? String(order.quantity) : '1',
    status: (order?.status ?? 'active') as ServiceOrderStatus,
    startDate: order?.startDate ?? '',
    endDate: order?.endDate ?? '',
  });
  const amount = parseFloat(f.amount.replace(/[^0-9.]/g, ''));
  const quantity = Math.max(1, parseInt(f.quantity, 10) || 1);

  async function save() {
    if (!Number.isFinite(amount) || amount <= 0) { showToast('Enter an amount in USD', 'error'); return; }
    setSaving(true);
    const data = {
      service: f.service, billing: f.billing, description: f.description.trim() || null,
      amount, quantity, status: f.status, startDate: f.startDate || null, endDate: f.endDate || null,
    };
    try {
      if (order) {
        await updateDoc(doc(db, 'serviceOrders', order.id), { ...data, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'serviceOrders'), {
          ...data, orgId: org.id, orgName: org.name, createdAt: serverTimestamp(), createdBy: actorName(),
        });
      }
      onDone();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
      setSaving(false);
    }
  }

  async function remove() {
    if (!order) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'serviceOrders', order.id));
      onDone();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
      setDeleting(false);
    }
  }

  const total = Number.isFinite(amount) ? amount * quantity : 0;

  return (
    <Modal open onClose={onClose} title={order ? 'Edit service order' : 'New service order'} size="lg">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Service">
          <select
            style={crmField}
            value={f.service}
            onChange={(e) => {
              const s = e.target.value as ServiceKind;
              setF((p) => ({ ...p, service: s, billing: order ? p.billing : DEFAULT_BILLING[s] }));
            }}
          >
            {(Object.keys(SERVICE_LABELS) as ServiceKind[]).map((k) => <option key={k} value={k}>{SERVICE_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Billing">
          <select style={crmField} value={f.billing} onChange={(e) => setF({ ...f, billing: e.target.value as BillingType })}>
            <option value="monthly">Monthly (recurring)</option>
            <option value="one_time">One-time</option>
          </select>
        </Field>
        <Field label="Description" span><input style={crmField} value={f.description} placeholder="2 × Senior Accountant" onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label={f.billing === 'monthly' ? 'Amount per unit, per month (USD)' : 'Amount per unit (USD)'}>
          <input style={crmField} value={f.amount} inputMode="decimal" placeholder="3500" onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Quantity"><input style={crmField} value={f.quantity} inputMode="numeric" onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="Start date"><input style={crmField} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="End date (optional)"><input style={crmField} type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="Status">
          <select style={crmField} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ServiceOrderStatus })}>
            {SERVICE_ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_STYLE[s].label}</option>)}
          </select>
        </Field>
        <div style={{ alignSelf: 'end', fontSize: 13, color: NW.gray600, paddingBottom: 10 }}>
          Total: <strong style={{ color: NW.black }}>{fmtUsd(total)}{f.billing === 'monthly' ? ' a month' : ''}</strong>
          {f.billing === 'monthly' && f.status === 'active' && <span> · adds {fmtUsd(total * 12)} to ARR</span>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
        {order && <HoldToDelete onConfirm={remove} busy={deleting} size="sm" label="Hold to delete" />}
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}
