'use client';

// ── What the AI is costing, per feature ──────────────────────────────────────
// The money here is small — a month of vetting is about a dollar. What this page
// is really for is the CALL COUNT. A call wired to the wrong trigger fires on
// every candidate instead of the few you interview, and at these prices that
// shows up as a count long before it shows up on an invoice.
//
// So the daily bars matter more than the totals: a step change in shape is the
// signal, not the number underneath it.

import { useState, useEffect, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { PageHeader } from '@/components/nw/shell-ui';
import { NW } from '@/components/nw/primitives';
import { Spinner } from '@/components/ui/spinner';

interface FeatureRow {
  feature: 'cv' | 'sourcing' | 'vetting';
  ownKey: boolean;
  dailyCap: number;
  todayCalls: number;
  monthCalls: number;
  monthUsd: number;
}
interface Usage {
  month: string;
  features: FeatureRow[];
  daily: Record<string, number | string>[];
}

const LABEL: Record<string, { name: string; what: string; color: string }> = {
  cv: { name: 'CV parsing', what: 'Once per candidate, ever', color: '#16A085' },
  sourcing: { name: 'X-ray sourcing', what: 'Once per opening, reused by Find more', color: '#3B82F6' },
  vetting: { name: 'Vetting', what: 'Kickoff, plus 2 per interviewed candidate', color: '#AF7AC5' },
};

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 18,
};

export default function AIUsagePage() {
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/ai-usage', { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const money = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`);
  const monthTotal = (data?.features || []).reduce((s, f) => s + f.monthUsd, 0);
  const peak = Math.max(
    1,
    ...(data?.daily || []).flatMap((d) => ['cv', 'sourcing', 'vetting'].map((f) => Number(d[`${f}_calls`] || 0))),
  );

  return (
    <MainLayout>
      <PageHeader
        title="AI usage"
        subtitle="Every Claude call in Admin, by feature. Watch the call counts — a wrong trigger shows up there first."
      />

      {loading && <div style={{ ...card, textAlign: 'center', padding: 34 }}><Spinner /></div>}

      {data && !loading && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ ...card, display: 'flex', gap: 30, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: NW.black }}>
                {money(monthTotal)}
              </div>
              <div style={{ fontSize: 12, color: NW.gray500 }}>this month, all features</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: NW.gray700 }}>
                {data.features.reduce((s, f) => s + f.monthCalls, 0)}
              </div>
              <div style={{ fontSize: 12, color: NW.gray500 }}>calls this month</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
            {data.features.map((f) => {
              const meta = LABEL[f.feature];
              const nearCap = f.todayCalls >= f.dailyCap * 0.8;
              return (
                <div key={f.feature} style={{ ...card, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: NW.gray400 }}>
                    {meta.name}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', color: NW.black, marginTop: 6 }}>
                    {money(f.monthUsd)}
                  </div>
                  <div style={{ fontSize: 12, color: NW.gray500 }}>
                    {f.monthCalls} call{f.monthCalls === 1 ? '' : 's'} this month
                  </div>
                  <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 8, lineHeight: 1.5 }}>{meta.what}</div>
                  <div style={{ fontSize: 11.5, marginTop: 6, color: nearCap ? '#B45309' : NW.gray400 }}>
                    Today {f.todayCalls} of {f.dailyCap}
                    {nearCap && ' — close to the cap'}
                  </div>
                  {/* A feature sharing the fallback key can't be told apart in the
                      Anthropic console, which is the whole point of separate keys. */}
                  {!f.ownKey && (
                    <div style={{ fontSize: 11, color: '#B45309', marginTop: 6 }}>
                      Using the shared key — set its own to separate the spend
                    </div>
                  )}
                  <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: meta.color }} />
                </div>
              );
            })}
          </div>

          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: NW.gray500, marginBottom: 12 }}>
              Calls per day · last 30 days
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 110 }}>
              {data.daily.map((d) => {
                const total = ['cv', 'sourcing', 'vetting'].reduce((s, f) => s + Number(d[`${f}_calls`] || 0), 0);
                return (
                  <div
                    key={String(d.day)}
                    title={`${d.day}: ${['cv', 'sourcing', 'vetting'].map((f) => `${LABEL[f].name} ${d[`${f}_calls`]}`).join(' · ')}`}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', minWidth: 4 }}
                  >
                    {(['cv', 'sourcing', 'vetting'] as const).map((f) => {
                      const n = Number(d[`${f}_calls`] || 0);
                      if (!n) return null;
                      return (
                        <div key={f} style={{ height: Math.max(2, (n / peak) * 96), background: LABEL[f].color }} />
                      );
                    })}
                    {total === 0 && <div style={{ height: 2, background: NW.gray100 }} />}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
              {(['cv', 'sourcing', 'vetting'] as const).map((f) => (
                <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: NW.gray600 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: LABEL[f].color }} />
                  {LABEL[f].name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
