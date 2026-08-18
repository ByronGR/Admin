'use client';

// ── People who still have access after being removed ─────────────────────────
// Client access is granted by the person's own user document. The organization's
// member list is only what staff see, so removing someone from that list alone
// left them fully able to use the portal and to sign back in — and took them off
// the screen, so there was nothing left to click to remove them again.
//
// This finds those accounts and closes them properly.

import { useState, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { PageHeader } from '@/components/nw/shell-ui';
import { Button, NW } from '@/components/nw/primitives';
import { useToast } from '@/components/ui/toast';

interface Orphan {
  uid: string; email: string; name: string;
  orgId: string; orgName: string; disabled: boolean; lastSignIn: string;
}

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 18,
};

export default function OrphanedAccessPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Orphan[] | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  const token = useCallback(async () => auth.currentUser?.getIdToken(), []);

  async function scan() {
    setBusy(true);
    try {
      const res = await fetch('/api/audit/orphaned-access', { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Scan failed', 'error'); return; }
      setRows(j.orphans as Orphan[]);
      setActive(j.active as number);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(one?: Orphan) {
    const label = one ? one.email : `${active} account${active === 1 ? '' : 's'}`;
    if (!confirm(`Revoke access for ${label}?\n\nTheir session ends immediately and they won't be able to sign in.`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/audit/orphaned-access', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify(one ? { uid: one.uid, orgId: one.orgId } : {}),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Revoke failed', 'error'); return; }
      showToast(`Revoked ${j.revoked}`, 'success');
      await scan();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MainLayout>
      <PageHeader
        title="Access after removal"
        subtitle="Accounts that can still open a client workspace they were removed from."
      />

      {!rows && (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 13.5, color: NW.gray500, maxWidth: 560, margin: '0 auto 18px', lineHeight: 1.6 }}>
            Removing a teammate used to edit the member list only, which is not what grants access —
            so anyone removed that way kept theirs. Read-only; nothing changes until you choose.
          </div>
          <Button onClick={scan} disabled={busy}>{busy ? 'Scanning…' : 'Run the check'}</Button>
        </div>
      )}

      {rows && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ ...card, display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: active ? '#B91C1C' : NW.teal700 }}>{active}</div>
              <div style={{ fontSize: 12, color: NW.gray500 }}>can still sign in</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: NW.gray700 }}>{rows.length}</div>
              <div style={{ fontSize: 12, color: NW.gray500 }}>found in total</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={scan} disabled={busy}>Re-check</Button>
              {active > 0 && <Button size="sm" onClick={() => revoke()} disabled={busy}>Revoke all {active}</Button>}
            </div>
          </div>

          {!rows.length ? (
            <div style={{ ...card, textAlign: 'center', padding: 34, fontSize: 13.5, color: NW.gray600 }}>
              Nobody has access to a workspace they were removed from.
            </div>
          ) : (
            <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 760 }}>
                <thead>
                  <tr style={{ background: NW.gray50 }}>
                    {['', 'Email', 'Workspace', 'Last sign-in', ''].map((h) => (
                      <th key={h} style={{ textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: NW.gray400, padding: '10px 12px', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.uid}:${r.orgId}`} style={{ borderTop: `1px solid ${NW.gray100}` }}>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                          background: r.disabled ? NW.gray100 : '#FEF2F2',
                          color: r.disabled ? NW.gray500 : '#B91C1C', whiteSpace: 'nowrap',
                        }}>
                          {r.disabled ? 'disabled' : 'can sign in'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600 }}>{r.email}</div>
                        {r.name && <div style={{ fontSize: 11.5, color: NW.gray500 }}>{r.name}</div>}
                      </td>
                      <td style={{ padding: '10px 12px', color: NW.gray600 }}>{r.orgName}</td>
                      <td style={{ padding: '10px 12px', color: NW.gray500, fontSize: 12 }}>
                        {r.lastSignIn ? new Date(r.lastSignIn).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {!r.disabled && (
                          <Button variant="secondary" size="sm" onClick={() => revoke(r)} disabled={busy}>Revoke</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </MainLayout>
  );
}
