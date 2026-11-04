// ============================================================
// Atlas CRM helpers — revenue maths and small shared formatters.
// MRR comes only from ACTIVE monthly service orders; ARR is MRR × 12.
// One-time revenue counts every non-draft one-time order.
// ============================================================

import { auth } from '@/lib/firebase';
import type { ServiceOrder, DealStage, CrmActivity, CrmTask, Deal } from '@/lib/types';
import { DEAL_STAGE_PROBABILITY } from '@/lib/types';

export interface Revenue {
  mrr: number;
  arr: number;
  oneTime: number;
  kind: 'recurring' | 'one_time' | 'none';
}

export function orderTotal(o: ServiceOrder): number {
  return (Number(o.amount) || 0) * (Number(o.quantity) || 1);
}

export function revenueFrom(orders: ServiceOrder[]): Revenue {
  let mrr = 0;
  let oneTime = 0;
  for (const o of orders) {
    if (o.billing === 'monthly' && o.status === 'active') mrr += orderTotal(o);
    if (o.billing === 'one_time' && o.status !== 'draft') oneTime += orderTotal(o);
  }
  return { mrr, arr: mrr * 12, oneTime, kind: mrr > 0 ? 'recurring' : oneTime > 0 ? 'one_time' : 'none' };
}

export const fmtUsd = (n?: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

// Who is acting, for createdBy fields.
export function actorName(): string {
  return auth.currentUser?.displayName || auth.currentUser?.email || 'Staff';
}
export function actorEmail(): string {
  return (auth.currentUser?.email || '').toLowerCase();
}

export const DEAL_STAGE_STYLE: Record<DealStage, { fg: string; bg: string }> = {
  Prospect: { fg: '#555555', bg: '#F5F4F0' },
  'Meeting booked': { fg: '#1D4ED8', bg: '#EFF6FF' },
  Proposal: { fg: '#7C3AED', bg: '#F7F2FC' },
  'Contract sent': { fg: '#A16207', bg: '#FEFCE8' },
  Client: { fg: '#0E6B58', bg: '#E8F8F5' },
  Lost: { fg: '#C0392B', bg: '#FEF0F0' },
};

// Today as YYYY-MM-DD in local time (for date inputs).
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Timeline & tracking helpers ───────────────────────────────────────────────

export function fmtDay(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDayTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// "Today", "Tomorrow", "Nov 12" — and whether it is already late.
export function dueInfo(dueDate?: string, dueTime?: string): { text: string; late: boolean; today: boolean } {
  if (!dueDate) return { text: 'No due date', late: false, today: false };
  const today = todayIso();
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const day = dueDate === today ? 'Today' : dueDate === tomorrow ? 'Tomorrow'
    : new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { text: dueTime ? `${day} · ${dueTime}` : day, late: dueDate < today, today: dueDate === today };
}


// Last thing that happened on a deal, and the next open task for it.
export function dealTracking(deal: Deal, activities: CrmActivity[], tasks: CrmTask[]) {
  const acts = activities.filter((a) => a.dealIds?.includes(deal.id) || a.dealId === deal.id);
  const last = acts.reduce<string | undefined>((m, a) => (!m || a.at > m ? a.at : m), undefined);
  const open = tasks.filter((t) => t.dealId === deal.id && !t.done)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  return { lastActivityAt: last, nextTask: open[0] as CrmTask | undefined };
}

export function weightedMrr(deals: Deal[]): number {
  return deals.reduce((n, d) => n + (Number(d.mrr) || 0) * (DEAL_STAGE_PROBABILITY[d.stage] ?? 0), 0);
}

export const contactHref = (id: string) => `/contacts/${encodeURIComponent(id)}`;
