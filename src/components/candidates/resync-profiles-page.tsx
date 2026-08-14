'use client';

// ── Refresh what clients can see ─────────────────────────────────────────────
// The client portal has no read access to the candidates collection, so every
// profile fact it displays is copied onto the pipeline entry when the candidate
// is added or edited. Add a field to that copy and existing entries keep the old
// shape until someone happens to edit that person — so a new field appears for
// candidates added since and is silently missing for everyone already in flight.
//
// From the client's side that reads as a half-working feature, which is why this
// exists as something you can run rather than something to wait out.

import { useState, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { PageHeader } from '@/components/nw/shell-ui';
import { Button, NW } from '@/components/nw/primitives';
import { useToast } from '@/components/ui/toast';

interface Plan { stale: number; missing: number; pipelines: number; affectedPipelines: number }

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 18,
};

export default function ResyncProfilesPage() {
  const { showToast } = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const token = useCallback(async () => auth.currentUser?.getIdToken(), []);

  async function check() {
    setBusy(true); setDone('');
    try {
      const res = await fetch('/api/pipelines/resync-snapshots', { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Check failed', 'error'); return; }
      setPlan(j as Plan);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!plan?.stale) return;
    if (!confirm(`Refresh ${plan.stale} candidate${plan.stale === 1 ? '' : 's'} across ${plan.affectedPipelines} pipeline${plan.affectedPipelines === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/pipelines/resync-snapshots', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Refresh failed', 'error'); return; }
      setDone(`Refreshed ${j.updated} candidate${j.updated === 1 ? '' : 's'} across ${j.pipelines} pipeline${j.pipelines === 1 ? '' : 's'}.`);
      await check();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MainLayout>
      <PageHeader
        title="Refresh client-facing profiles"
        subtitle="Copies the current candidate profile onto every pipeline entry, so clients see the same facts Admin does."
      />

      <div style={{ ...card, marginBottom: 16, fontSize: 13, color: NW.gray600, lineHeight: 1.65, maxWidth: 640 }}>
        Clients can&apos;t read candidate records directly — the portal shows a copy taken when the
        candidate was added. This rewrites those copies from the live record. Safe to run at any
        time: entries added by hand, with no candidate record behind them, are left untouched.
      </div>

      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button onClick={check} disabled={busy} variant={plan ? 'secondary' : 'primary'}>
          {busy && !plan ? 'Checking…' : "Check what's out of date"}
        </Button>
        {plan && plan.stale > 0 && (
          <Button onClick={run} disabled={busy}>{busy ? 'Refreshing…' : `Refresh ${plan.stale}`}</Button>
        )}
      </div>

      {plan && (
        <div style={{ ...card, marginTop: 16, display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: plan.stale ? '#B45309' : NW.teal700 }}>{plan.stale}</div>
            <div style={{ fontSize: 12, color: NW.gray500 }}>out of date</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: NW.gray700 }}>{plan.pipelines}</div>
            <div style={{ fontSize: 12, color: NW.gray500 }}>pipelines checked</div>
          </div>
          {/* Say what was skipped, so a small number isn't mistaken for a clean bill. */}
          {plan.missing > 0 && (
            <div style={{ fontSize: 11.5, color: NW.gray500, lineHeight: 1.6, maxWidth: 280 }}>
              {plan.missing} entr{plan.missing === 1 ? 'y has' : 'ies have'} no candidate record behind
              {plan.missing === 1 ? ' it' : ' them'} and {plan.missing === 1 ? 'was' : 'were'} left alone.
            </div>
          )}
          {done && (
            <div style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: NW.teal700 }}>{done}</div>
          )}
        </div>
      )}
    </MainLayout>
  );
}
