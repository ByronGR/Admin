'use client';

// ── Why can't this teammate see anything? ────────────────────────────────────
// A staffer failing the Firestore staff gate can still log in and use Admin —
// every internal collection just reads back empty. Candidates show 0, pipelines
// look unstarted, nothing errors. It's indistinguishable from "there is no
// data", which is why it gets reported as a broken app instead of a permission
// problem, and why it takes days to find.
//
// This names the failing check instead.

import { useState, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { PageHeader } from '@/components/nw/shell-ui';
import { Button, NW } from '@/components/nw/primitives';
import { useToast } from '@/components/ui/toast';
import { Check, X } from 'lucide-react';

interface Gate { name: string; ok: boolean; detail: string; fix?: string }
interface StaffRow {
  email: string; uid: string; name: string; role: string;
  employmentType: string; status: string; providers: string[]; passes: boolean; why: string;
}
interface Result {
  email: string; found: boolean; uid?: string; name?: string;
  providers?: string[]; breakGlass?: boolean; passes?: boolean;
  gates: Gate[]; summary: string;
}

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 18,
};

const ROLES = ['super_admin', 'admin', 'sr_recruiter', 'recruiter', 'account_manager', 'sales', 'hr', 'employee'];

export default function AccessCheckPage() {
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('recruiter');
  const [result, setResult] = useState<Result | null>(null);
  const [list, setList] = useState<StaffRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const token = useCallback(async () => auth.currentUser?.getIdToken(), []);

  async function check(addr = email) {
    if (!addr.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/audit/access?email=${encodeURIComponent(addr.trim())}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Check failed', 'error'); return; }
      setResult(j as Result);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function listAll() {
    setBusy(true);
    try {
      const res = await fetch('/api/audit/access', { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Failed', 'error'); return; }
      setList(j.list as StaffRow[]);
      setResult(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function repair() {
    if (!result?.email) return;
    if (!confirm(`Give ${result.email} staff access as "${role}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/audit/access', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email: result.email, role }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Repair failed', 'error'); return; }
      showToast('Access restored — they should refresh Admin', 'success');
      await check(result.email);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MainLayout>
      <PageHeader
        title="Staff access check"
        subtitle="When a teammate sees zero candidates and empty pipelines, this says which check is denying them."
      />

      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
          placeholder="name@nearwork.co"
          style={{ flex: 1, minWidth: 240, height: 40, borderRadius: 10, border: `1px solid ${NW.gray200}`, padding: '0 12px', font: 'inherit', fontSize: 13.5, outline: 'none' }}
        />
        <Button onClick={() => check()} disabled={busy}>{busy ? 'Checking…' : 'Check'}</Button>
        <Button variant="secondary" onClick={listAll} disabled={busy}>Show every Nearwork account</Button>
      </div>

      {list && (
        <div style={{ ...card, padding: 0, overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5, minWidth: 860 }}>
            <thead>
              <tr style={{ background: NW.gray50 }}>
                {['', 'Email', 'Role', 'Employment', 'Status', 'Signs in with', 'uid'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: NW.gray400, padding: '10px 12px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.uid} style={{ borderTop: `1px solid ${NW.gray100}`, background: r.passes ? undefined : '#FEF2F2' }}>
                  <td style={{ padding: '9px 12px' }}>
                    {r.passes ? <Check size={14} color="#047857" /> : <X size={14} color="#B91C1C" />}
                  </td>
                  <td style={{ padding: '9px 12px', fontWeight: 600, color: NW.black }}>
                    {r.email}
                    {!r.passes && <div style={{ fontWeight: 400, color: '#B91C1C', fontSize: 11.5 }}>{r.why}</div>}
                  </td>
                  <td style={{ padding: '9px 12px', color: NW.gray600 }}>{r.role}</td>
                  <td style={{ padding: '9px 12px', color: NW.gray600 }}>{r.employmentType}</td>
                  <td style={{ padding: '9px 12px', color: NW.gray600 }}>{r.status}</td>
                  <td style={{ padding: '9px 12px', color: NW.gray600 }}>{r.providers.join(', ') || '—'}</td>
                  <td style={{ padding: '9px 12px', color: NW.gray400, fontSize: 11 }}>{r.uid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{
            ...card,
            background: result.passes ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${result.passes ? '#A7F3D0' : '#FECACA'}`,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: result.passes ? '#047857' : '#B91C1C', marginBottom: 4 }}>
              {result.found ? (result.passes ? 'Has access' : 'Blocked') : 'No account found'}
            </div>
            <div style={{ fontSize: 13, color: NW.gray700, lineHeight: 1.6 }}>{result.summary}</div>
            {result.found && (
              <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 8 }}>
                {result.name || '—'} · signs in with {(result.providers || []).join(', ') || 'unknown'} · uid {result.uid}
              </div>
            )}
          </div>

          {result.found && result.gates.length > 0 && (
            <div style={{ ...card, padding: 0 }}>
              {result.gates.map((g, i) => (
                <div key={g.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '13px 18px', borderTop: i === 0 ? 'none' : `1px solid ${NW.gray100}` }}>
                  {g.ok
                    ? <Check size={16} color="#047857" style={{ flexShrink: 0, marginTop: 1 }} />
                    : <X size={16} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: g.ok ? NW.gray700 : '#B91C1C' }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: NW.gray500, marginTop: 1 }}>{g.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.found && !result.passes && (
            <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: NW.gray600 }}>Restore access as</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={{ height: 36, borderRadius: 9, border: `1px solid ${NW.gray200}`, padding: '0 10px', font: 'inherit', fontSize: 12.5 }}
              >
                {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
              <Button size="sm" onClick={repair} disabled={busy}>Fix access</Button>
              <span style={{ fontSize: 11.5, color: NW.gray500 }}>
                Sets employment type to internal, status to active, and the role above. Only works for
                @nearwork.co addresses.
              </span>
            </div>
          )}
        </div>
      )}
    </MainLayout>
  );
}
