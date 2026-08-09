'use client';

// ── Accounts with no candidate record ────────────────────────────────────────
// Someone can sign up and get a login without ever getting an ATS record, which
// makes them invisible to staff. This finds them and, only when asked, creates
// what's missing.
//
// Nothing is written until the button is pressed, and the server re-checks every
// candidate against a fresh index before creating anything — a duplicate is a
// worse outcome than a missing record, because a missing one can be repaired and
// a duplicate has to be found first.

import { useState, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { PageHeader } from '@/components/nw/shell-ui';
import { Button, NW } from '@/components/nw/primitives';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';

interface Orphan {
  uid: string; email: string; name: string;
  provider: string; createdAt: string; lastSignIn: string;
}
interface Report {
  scanned: number;
  candidateRecords: number;
  orphans: Orphan[];
  byProvider: Record<string, number>;
  excluded: { noProfile: number; client: number; staff: number };
}

const PROVIDER_LABEL: Record<string, string> = {
  'google.com': 'Google',
  password: 'Email & password',
  linkedin: 'LinkedIn',
};

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 18,
};

export default function AccountAuditPage() {
  const { showToast } = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState('');

  const token = useCallback(async () => auth.currentUser?.getIdToken(), []);

  async function scan() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/audit/accounts', { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json();
      if (!res.ok) { setError(j.error || 'Scan failed'); return; }
      setReport(j as Report);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function repair() {
    if (!report?.orphans.length) return;
    if (!confirm(`Create candidate records for ${report.orphans.length} account${report.orphans.length === 1 ? '' : 's'}?`)) return;
    setFixing(true);
    try {
      const res = await fetch('/api/audit/accounts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ uids: report.orphans.map((o) => o.uid) }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Repair failed', 'error'); return; }
      showToast(
        `Created ${j.created.length}${j.skipped.length ? ` · skipped ${j.skipped.length} that already existed` : ''}`,
        'success',
      );
      await scan();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setFixing(false);
    }
  }

  return (
    <MainLayout>
      <PageHeader
        title="Accounts without a candidate record"
        subtitle="Candidate accounts that can sign in but don't appear anywhere in Admin. Clients and staff are excluded."
      />

      {!report && (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 13.5, color: NW.gray500, maxWidth: 520, margin: '0 auto 18px', lineHeight: 1.6 }}>
            Compares every login account against the candidate list. Read-only — nothing is written
            until you choose to.
          </div>
          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, marginBottom: 14, textAlign: 'left' }}>
              {error}
            </div>
          )}
          <Button onClick={scan} disabled={loading}>{loading ? 'Scanning…' : 'Run the check'}</Button>
        </div>
      )}

      {loading && report && <div style={{ ...card, textAlign: 'center', padding: 30 }}><Spinner /></div>}

      {report && !loading && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ ...card, display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: report.orphans.length ? '#B45309' : NW.teal700 }}>
                {report.orphans.length}
              </div>
              <div style={{ fontSize: 12, color: NW.gray500 }}>missing a record</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: NW.gray700 }}>{report.scanned}</div>
              <div style={{ fontSize: 12, color: NW.gray500 }}>login accounts</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: NW.gray700 }}>{report.candidateRecords}</div>
              <div style={{ fontSize: 12, color: NW.gray500 }}>candidate records</div>
            </div>
            {/* Say what was left out. A smaller number is only reassuring if you
                can see it isn't smaller because something was quietly dropped. */}
            <div style={{ fontSize: 11.5, color: NW.gray500, lineHeight: 1.6, maxWidth: 300 }}>
              Excluded: {report.excluded.client} client user{report.excluded.client === 1 ? '' : 's'} ·{' '}
              {report.excluded.staff} Nearwork staff ·{' '}
              {report.excluded.noProfile} who never finished signing up
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={scan}>Re-check</Button>
              {report.orphans.length > 0 && (
                <Button size="sm" onClick={repair} disabled={fixing}>
                  {fixing ? 'Creating…' : `Create ${report.orphans.length} record${report.orphans.length === 1 ? '' : 's'}`}
                </Button>
              )}
            </div>
          </div>

          {!report.orphans.length ? (
            <div style={{ ...card, textAlign: 'center', padding: 34, fontSize: 13.5, color: NW.gray600 }}>
              Every login account has a candidate record. Nothing to fix.
            </div>
          ) : (
            <>
              <div style={{ ...card, fontSize: 12.5, color: NW.gray600, lineHeight: 1.6 }}>
                Grouped by how they signed up:{' '}
                {Object.entries(report.byProvider)
                  .map(([p, n]) => `${PROVIDER_LABEL[p] || p} — ${n}`)
                  .join(' · ')}
                <div style={{ marginTop: 8, color: NW.gray500 }}>
                  Creating a record keeps their original sign-up date, so the intake chart stays
                  truthful rather than showing a spike today. Each one is re-checked server-side
                  first, so anyone who has since created their own record is skipped.
                </div>
              </div>

              <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: NW.gray50 }}>
                      {['Name', 'Email', 'Signed up with', 'Created', 'Last sign-in'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: NW.gray400, padding: '10px 14px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.orphans.map((o) => (
                      <tr key={o.uid} style={{ borderTop: `1px solid ${NW.gray100}` }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: NW.black }}>{o.name || '—'}</td>
                        <td style={{ padding: '10px 14px', color: NW.gray600 }}>{o.email || '—'}</td>
                        <td style={{ padding: '10px 14px', color: NW.gray600 }}>{PROVIDER_LABEL[o.provider] || o.provider}</td>
                        <td style={{ padding: '10px 14px', color: NW.gray500, whiteSpace: 'nowrap' }}>
                          {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', color: NW.gray500, whiteSpace: 'nowrap' }}>
                          {o.lastSignIn ? new Date(o.lastSignIn).toLocaleDateString() : 'never'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </MainLayout>
  );
}
