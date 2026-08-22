'use client';

// ── Who is showing as an email address ───────────────────────────────────────
// The portal needs a name to show a person by. Without one it falls back to
// their email — and until recently that fallback was the raw address, which
// also got written into the author line of every note and request they posted.
// This finds the accounts with no name, and lets staff set one.

import { useState, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { PageHeader } from '@/components/nw/shell-ui';
import { Button, NW } from '@/components/nw/primitives';
import { useToast } from '@/components/ui/toast';

interface Person {
  uid: string; email: string; role: string; orgName: string;
  showsAs: string; guess: string; posts: number;
}
interface Report { people: Person[]; stamped: number; stampedBy: { email: string; count: number }[] }

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 18,
};

export default function DisplayNamesPage() {
  const { showToast } = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const token = useCallback(async () => auth.currentUser?.getIdToken(), []);

  async function scan() {
    setBusy(true);
    try {
      const res = await fetch('/api/audit/display-names', { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Check failed', 'error'); return; }
      setReport(j as Report);
      const d: Record<string, string> = {};
      (j.people as Person[]).forEach((p) => { d[p.uid] = p.guess; });
      setDrafts(d);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function save(p: Person) {
    const name = (drafts[p.uid] || '').trim();
    if (!name) { showToast('Enter a name first', 'error'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/audit/display-names', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ uid: p.uid, name }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Could not save', 'error'); return; }
      showToast(`Saved — ${p.email} now shows as ${j.name}`, 'success');
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
        title="Showing as an email"
        subtitle="Client accounts with no name saved. The portal falls back to their email address."
      />

      {!report && (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 13.5, color: NW.gray500, maxWidth: 560, margin: '0 auto 18px', lineHeight: 1.6 }}>
            Read-only until you choose to set a name. New invites capture a name, and people are now
            asked for one on first login — this is for accounts that predate both.
          </div>
          <Button onClick={scan} disabled={busy}>{busy ? 'Checking…' : 'Run the check'}</Button>
        </div>
      )}

      {report && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ ...card, display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: report.people.length ? '#B45309' : NW.teal700 }}>{report.people.length}</div>
              <div style={{ fontSize: 12, color: NW.gray500 }}>with no name saved</div>
            </div>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: NW.gray700 }}>{report.stamped}</div>
              <div style={{ fontSize: 12, color: NW.gray500 }}>notes signed with an email</div>
            </div>
            {/* Said out loud: setting a name fixes what they are called from now
                on, not what a note already says. */}
            <div style={{ fontSize: 11.5, color: NW.gray500, lineHeight: 1.6, maxWidth: 320 }}>
              Setting a name changes what they are shown as from now on. Notes already posted keep
              the author they were saved with.
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <Button variant="secondary" size="sm" onClick={scan} disabled={busy}>Re-check</Button>
            </div>
          </div>

          {!report.people.length ? (
            <div style={{ ...card, textAlign: 'center', padding: 34, fontSize: 13.5, color: NW.gray600 }}>
              Every client account has a name. Nobody is showing as an email address.
            </div>
          ) : (
            <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 820 }}>
                <thead>
                  <tr style={{ background: NW.gray50 }}>
                    {['Email', 'Workspace', 'Shows as today', 'Notes signed', 'Set their name', ''].map((h) => (
                      <th key={h} style={{ textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: NW.gray400, padding: '10px 12px', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.people.map((p) => (
                    <tr key={p.uid} style={{ borderTop: `1px solid ${NW.gray100}` }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{p.email}</td>
                      <td style={{ padding: '10px 12px', color: NW.gray600 }}>{p.orgName}</td>
                      <td style={{ padding: '10px 12px', color: NW.gray600 }}>{p.showsAs}</td>
                      <td style={{ padding: '10px 12px', color: p.posts ? '#B45309' : NW.gray400, fontWeight: p.posts ? 600 : 400 }}>
                        {p.posts || '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <input
                          value={drafts[p.uid] ?? ''}
                          onChange={(e) => setDrafts((d) => ({ ...d, [p.uid]: e.target.value }))}
                          placeholder="Jane Doe"
                          style={{ width: 190, height: 34, borderRadius: 8, border: `1px solid ${NW.gray200}`, padding: '0 10px', font: 'inherit', fontSize: 13, outline: 'none' }}
                        />
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <Button size="sm" onClick={() => save(p)} disabled={busy}>Save</Button>
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
