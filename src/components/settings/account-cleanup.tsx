'use client';

// Settings → Data cleanup
// Read-only scan that cross-checks Firebase Auth users against candidate records
// and lists "orphaned" login accounts — non-staff, non-client accounts that have
// a login but no candidate profile (leftovers from the old delete that never
// removed the Auth account, or abandoned sign-ups). Each row can be permanently
// removed with a press-and-hold, reusing the same full-purge endpoint.

import { useState } from 'react';
import { auth } from '@/lib/firebase';
import { useToast } from '@/components/ui/toast';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { NW, Icon, Button } from '@/components/nw/primitives';
import { Card, CardHead } from '@/components/nw/shell-ui';

interface Orphan {
  uid: string;
  email: string;
  name: string;
  createdAt: string | null;
  lastSignIn: string | null;
  hasUsersDoc: boolean;
}

function fmt(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AccountCleanup() {
  const { showToast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<number | null>(null);
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);

  async function token(): Promise<string> {
    const t = await auth.currentUser?.getIdToken();
    if (!t) throw new Error('Your session expired — please sign in again.');
    return t;
  }

  async function scan() {
    setScanning(true);
    try {
      const res = await fetch('/api/delete-candidate', { headers: { Authorization: `Bearer ${await token()}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Scan failed');
      setOrphans(data.orphans as Orphan[]);
      setScanned(data.scanned as number);
    } catch (e) {
      showToast((e as Error)?.message || 'Scan failed', 'error');
    } finally {
      setScanning(false);
    }
  }

  async function remove(o: Orphan) {
    setDeletingUid(o.uid);
    try {
      const res = await fetch('/api/delete-candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ uid: o.uid, email: o.email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Delete failed');
      setOrphans((prev) => (prev ? prev.filter((x) => x.uid !== o.uid) : prev));
      showToast(`Removed ${o.email}`, 'success');
    } catch (e) {
      showToast((e as Error)?.message || 'Failed to delete', 'error');
    } finally {
      setDeletingUid(null);
    }
  }

  return (
    <Card>
      <CardHead
        icon="shield-alert"
        title="Data cleanup — orphaned accounts"
        sub="Login accounts with no candidate profile (leftovers from older deletes or abandoned sign-ups). Staff and client accounts are never listed."
        action={<Button variant="secondary" size="sm" icon="refresh-cw" onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan Firebase'}</Button>}
      />

      {orphans === null ? (
        <div style={{ padding: '18px 4px', fontSize: 13, color: NW.gray500 }}>
          Run a scan to cross-check every Firebase login against candidate records. Nothing is deleted until you press-and-hold on a row.
        </div>
      ) : orphans.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 4px', fontSize: 13, color: NW.gray600 }}>
          <Icon name="check-circle-2" size={18} color={NW.green600} /> No orphaned accounts found{scanned != null ? ` · ${scanned} logins checked` : ''}.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 12px', fontSize: 12.5, color: NW.gray500 }}>
            <Icon name="info" size={14} color={NW.gray400} />
            {orphans.length} orphaned account{orphans.length === 1 ? '' : 's'} · {scanned} logins checked. Review each — a hired person or client should not appear here.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {orphans.map((o) => (
              <div key={o.uid} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '13px 0', borderTop: `1px solid ${NW.gray100}` }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{o.email}</div>
                  <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 2 }}>
                    {o.name ? `${o.name} · ` : ''}created {fmt(o.createdAt)} · last sign-in {fmt(o.lastSignIn)}
                    {o.hasUsersDoc ? ' · has profile leftovers' : ''}
                  </div>
                </div>
                <HoldToDelete onConfirm={() => remove(o)} busy={deletingUid === o.uid} label="Hold to remove" />
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
