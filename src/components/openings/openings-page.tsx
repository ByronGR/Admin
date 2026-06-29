'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { sortByTimestamp, generateCode, fmtCurrency } from '@/lib/utils';
import type { Opening, Pipeline } from '@/lib/types';
import { NW, MONO, Button as NWButton } from '@/components/nw/primitives';
import { PageHeader, Card as NWCard, StatusBadge } from '@/components/nw/shell-ui';

type OpeningTab = 'active' | 'pending' | 'paused' | 'completed';

// Map a real opening (status + brief/approval state) to the prototype's tabs.
function openingTab(o: Opening): OpeningTab {
  const s = o.status;
  if (s === 'paused') return 'paused';
  if (s === 'filled' || s === 'cancelled') return 'completed';
  if (s === 'draft') return 'pending';
  if (o.briefStatus === 'submitted' || o.briefStatus === 'changes_requested') return 'pending';
  return 'active';
}

function statusKey(o: Opening): string {
  const t = openingTab(o);
  return t === 'active' ? 'active' : t === 'pending' ? 'pending' : t === 'paused' ? 'paused' : 'completed';
}

export default function OpeningsPage() {
  const { showToast } = useToast();
  const router = useRouter();

  const [openings, setOpenings] = useState<Opening[]>([]);
  const [counts, setCounts] = useState<Record<string, { pipeline: number; review: number }>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<OpeningTab>('active');

  useEffect(() => {
    Promise.allSettled([
      getDocs(collection(db, 'openings')),
      getDocs(collection(db, 'pipelines')),
    ])
      .then(([oRes, pRes]) => {
        if (oRes.status === 'fulfilled') {
          setOpenings(sortByTimestamp(oRes.value.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)), 'createdAt'));
        } else {
          showToast('Failed to load openings', 'error');
        }
        if (pRes.status === 'fulfilled') {
          const m: Record<string, { pipeline: number; review: number }> = {};
          pRes.value.docs.forEach((d) => {
            const p = d.data() as Pipeline;
            if (!p.code) return;
            const cands = p.candidates ?? [];
            m[p.code] = { pipeline: cands.length, review: cands.filter((c) => c.pendingReview).length };
          });
          setCounts(m);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // One-click creation: generate a code, write the opening + pipeline, then go
  // straight to the kick-off brief where all the details are captured.
  async function handleNewOpening() {
    if (creating) return;
    setCreating(true);
    try {
      const code = generateCode('NW');
      await setDoc(doc(db, 'openings', code), {
        code,
        status: 'draft',
        approvalStatus: 'draft',
        published: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'pipelines', code), {
        code,
        status: 'active',
        candidates: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      router.push(`/kickoff?code=${encodeURIComponent(code)}`);
    } catch {
      showToast('Failed to create opening', 'error');
      setCreating(false);
    }
  }

  const tabCounts: Record<OpeningTab, number> = {
    active: openings.filter((o) => openingTab(o) === 'active').length,
    pending: openings.filter((o) => openingTab(o) === 'pending').length,
    paused: openings.filter((o) => openingTab(o) === 'paused').length,
    completed: openings.filter((o) => openingTab(o) === 'completed').length,
  };
  const rows = openings.filter((o) => openingTab(o) === tab);

  const TABS: { id: OpeningTab; label: string }[] = [
    { id: 'active', label: 'Active' },
    { id: 'pending', label: 'Pending approval' },
    { id: 'paused', label: 'Paused' },
    { id: 'completed', label: 'Completed' },
  ];

  function band(o: Opening): string {
    if (o.hideSalary) return 'Hidden';
    const cur = o.salaryCurrency || 'USD';
    const min = o.salaryMin && o.salaryMin > 0 ? o.salaryMin : null;
    const max = o.salaryMax && o.salaryMax > 0 ? o.salaryMax : null;
    if (min && max) return `${fmtCurrency(min, cur)}–${fmtCurrency(max, cur)}`;
    if (min) return `${fmtCurrency(min, cur)}+`;
    if (max) return `Up to ${fmtCurrency(max, cur)}`;
    return '—';
  }

  return (
    <MainLayout>
      <PageHeader
        overline="Pipeline"
        title="Openings"
        subtitle="Requisitions you've scoped for partners — from approval through to filled."
        actions={
          <NWButton variant="primary" size="md" icon={creating ? undefined : 'plus'} onClick={handleNewOpening} disabled={creating}>
            {creating ? 'Creating…' : 'New opening'}
          </NWButton>
        }
      />

      {/* Status tabs */}
      <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: NW.gray50, borderRadius: 10, border: `1px solid ${NW.gray100}`, marginBottom: 16 }}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{ fontSize: 12.5, fontWeight: on ? 600 : 500, cursor: 'pointer', border: 'none', color: on ? NW.black : NW.gray500, background: on ? NW.white : 'transparent', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06)' : 'none', borderRadius: 7, padding: '6px 13px', display: 'inline-flex', alignItems: 'center', gap: 7 }}
            >
              {t.label}
              <span style={{ fontFamily: MONO, fontSize: 11, color: on ? NW.teal700 : NW.gray400 }}>{tabCounts[t.id]}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ display: 'flex', height: 160, alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>
      ) : (
        <NWCard pad={0}>
          <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.4fr 0.9fr 1fr 1fr 0.7fr', gap: 16, padding: '16px 20px' }}>
            {['Opening', 'Location · band', 'Pipeline', 'Review', 'Owner', ''].map((h, i) => (
              <div key={h || i} style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: NW.gray400, textAlign: i === 5 ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>
          {rows.length === 0 ? (
            <div style={{ padding: '28px 20px', fontSize: 13, color: NW.gray400, borderTop: `1px solid ${NW.gray100}` }}>
              No {tab === 'pending' ? 'requisitions awaiting approval' : `${tab} openings`} right now.
            </div>
          ) : (
            rows.map((o) => {
              const c = counts[o.code ?? ''] ?? { pipeline: 0, review: 0 };
              return (
                <div
                  key={o.id}
                  onClick={() => router.push(`/openings/${o.code ?? o.id}`)}
                  className="nw-grid-row"
                  style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.4fr 0.9fr 1fr 1fr 0.7fr', gap: 16, alignItems: 'center', padding: '16px 20px', borderTop: `1px solid ${NW.gray100}`, cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
                    <span style={{ width: 38, height: 38, borderRadius: 9, background: NW.teal500 + '18', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={NW.teal600} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.title || 'Untitled role'}</span>
                        <span style={{ fontFamily: MONO, fontSize: 10.5, color: NW.gray400, background: NW.gray50, borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>{o.code ?? '—'}</span>
                      </div>
                      <div style={{ fontSize: 12, color: NW.gray500, marginTop: 1 }}>{o.orgName ?? '—'}{o.department ? ` · ${o.department}` : ''}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, color: NW.gray600 }}>
                    <div>{o.location ?? 'Remote'}</div>
                    <div style={{ color: NW.gray400, marginTop: 2, fontFamily: MONO, fontSize: 11.5 }}>{band(o)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={NW.gray400} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    <span style={{ fontFamily: MONO, fontSize: 13.5, color: NW.gray700 }}>{c.pipeline}</span>
                  </div>
                  <div>
                    {c.review > 0 ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#A16207', background: NW.yellow50, border: '1px solid #EAB30840', borderRadius: 999, padding: '3px 9px' }}>{c.review} to review</span>
                    ) : (
                      <span style={{ fontSize: 12.5, color: NW.gray400 }}>Clear</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, color: NW.gray600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.recruiter ?? '—'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <StatusBadge status={statusKey(o)} label={tab === 'pending' ? 'Pending' : tab === 'completed' ? (o.status === 'filled' ? 'Filled' : 'Completed') : (o.status ? o.status[0].toUpperCase() + o.status.slice(1) : 'Active')} />
                  </div>
                </div>
              );
            })
          )}
        </NWCard>
      )}
    </MainLayout>
  );
}
