'use client';

// ── Vera, inside Admin ───────────────────────────────────────────────────────
// The same data Vera's own console shows, drawn in Admin's chrome and reached
// through Admin's sign-in.
//
// Nothing is stored here. Every number comes from Vera through /api/vera, which
// verifies the Firebase user and then calls Vera as a service, naming who it is
// acting for. Admin has no copy of a candidate, a credit balance or an assessment
// — a second copy would be a second thing to be wrong, and the one number that
// must never be wrong is a client's balance.

import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { NW, Button, Chip } from '@/components/nw/primitives';

interface Org { id: string; name: string; slug: string | null; balance: number }
interface Candidate {
  hash: string; name: string; email: string; role: string; status: string;
  consented: boolean; situations: number; experience: number;
  graded: boolean; spokenEnglish: string | null; credits: number; reissued: boolean;
}
interface Bank {
  id: string; title: string; status: string; source: string;
  scenarios: number; questions: number; supportedLengths: number[]; costUsd: number;
}

const VERA_URL = 'https://vera-ruddy-three.vercel.app';

export default function VeraPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Not signed in');
    const res = await fetch(`/api/vera/${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      cache: 'no-store',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Vera did not answer');
    return data;
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await call('console');
      setOrgs(d.organisations ?? []);
      setCandidates(d.candidates ?? []);
      setBanks(d.banks ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Vera');
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    const stop = auth.onAuthStateChanged((u) => { if (u) void load(); });
    return () => stop();
  }, [load]);

  const addCredits = async (org: Org) => {
    const amount = Number(window.prompt(`How many credits for ${org.name}? (currently ${org.balance})`));
    if (!Number.isFinite(amount) || amount === 0) return;
    const note = window.prompt('What is this for?') ?? '';
    setBusy(true);
    try {
      await call('credits', {
        method: 'POST',
        body: JSON.stringify({ org: org.slug ?? org.id, amount, kind: amount > 0 ? 'granted' : 'adjusted', note }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply that');
    } finally { setBusy(false); }
  };

  const reissue = async (c: Candidate) => {
    const reason = window.prompt(`New link for ${c.name}. Why is the old one being killed?`);
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const d = await call(`assessments?hash=${c.hash}`, {
        method: 'PATCH', body: JSON.stringify({ reason }),
      });
      window.prompt('New link — the old one is already dead:', d.link);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reissue');
    } finally { setBusy(false); }
  };

  const th: React.CSSProperties = {
    textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
    letterSpacing: '0.04em', textTransform: 'uppercase', color: NW.gray500,
    borderBottom: `1px solid ${NW.gray200}`,
  };
  const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13.5, borderBottom: `1px solid ${NW.gray100}` };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Vera</h1>
        <span style={{ fontSize: 13, color: NW.gray500 }}>Assessments, credits and candidates.</span>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 9, background: NW.rose50, color: NW.rose500, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 24, color: NW.gray500, fontSize: 14 }}>Loading…</p>
      ) : (
        <>
          {/* ── Clients ──────────────────────────────────────────────────── */}
          <section style={{ marginTop: 26 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Clients</h2>
            <p style={{ fontSize: 12.5, color: NW.gray500, margin: '0 0 12px' }}>
              A credit is spent when a candidate starts, not when a link is sent.
            </p>
            <div style={{ border: `1px solid ${NW.gray200}`, borderRadius: 11, overflow: 'hidden', background: NW.white }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Client</th><th style={th}>Credits left</th><th style={th} /></tr></thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id}>
                      <td style={{ ...td, fontWeight: 500 }}>{o.name}</td>
                      <td style={td}>
                        {/* Flagged low rather than only shown. The moment a balance
                            matters is when a candidate cannot start and nobody saw
                            it coming. */}
                        {o.balance < 5
                          ? <Chip variant="rose">{o.balance} — running out</Chip>
                          : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{o.balance}</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => addCredits(o)}>
                          Add credits
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Candidates ───────────────────────────────────────────────── */}
          <section style={{ marginTop: 30 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Candidates</h2>
            <div style={{ border: `1px solid ${NW.gray200}`, borderRadius: 11, overflow: 'hidden', background: NW.white }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Candidate</th><th style={th}>Role</th><th style={th}>Status</th>
                    <th style={th}>Report</th><th style={th}>English</th><th style={th}>Credits</th><th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.hash}>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, color: NW.gray500 }}>{c.email}</div>
                      </td>
                      <td style={{ ...td, color: NW.gray600 }}>{c.role}</td>
                      <td style={td}>
                        {c.status.replace('_', ' ')}
                        {!c.consented && c.status !== 'sent' && (
                          <div style={{ fontSize: 11.5, color: NW.gray500 }}>no consent recorded</div>
                        )}
                      </td>
                      {/* Whether a report is ready, never what it said. Vera has no
                          overall grade, and a column here is exactly where one would
                          come back. */}
                      <td style={td}>
                        {c.graded
                          ? <a href={`${VERA_URL}/client/${c.hash}`} target="_blank" rel="noopener noreferrer" style={{ color: NW.teal700 }}>Open</a>
                          : <span style={{ color: NW.gray400 }}>—</span>}
                      </td>
                      <td style={td}>{c.spokenEnglish ?? <span style={{ color: NW.gray400 }}>—</span>}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{c.credits}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <a href={`${VERA_URL}/a/${c.hash}`} target="_blank" rel="noopener noreferrer" style={{ color: NW.teal700, fontSize: 12.5 }}>Their link</a>
                        {c.status !== 'completed' && (
                          <>
                            <span style={{ color: NW.gray300, margin: '0 6px' }}>·</span>
                            <button
                              type="button" onClick={() => reissue(c)} disabled={busy}
                              style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12.5, color: NW.gray500, textDecoration: 'underline', cursor: 'pointer' }}
                            >
                              {c.reissued ? 'Reissue again' : 'Reissue'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Question sets ────────────────────────────────────────────── */}
          <section style={{ marginTop: 30, marginBottom: 40 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Question sets</h2>
            <div style={{ border: `1px solid ${NW.gray200}`, borderRadius: 11, overflow: 'hidden', background: NW.white }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th style={th}>Role</th><th style={th}>Status</th><th style={th}>Situations</th><th style={th}>Lengths</th><th style={th}>Cost</th></tr>
                </thead>
                <tbody>
                  {banks.map((b) => (
                    <tr key={b.id}>
                      <td style={{ ...td, fontWeight: 500 }}>{b.title}</td>
                      <td style={td}>
                        {b.status === 'ready' ? <Chip variant="success">ready</Chip> : <Chip variant="default">{b.status}</Chip>}
                      </td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{b.scenarios}</td>
                      <td style={{ ...td, color: NW.gray600 }}>{b.supportedLengths.join(', ') || '—'}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: NW.gray600 }}>${b.costUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
