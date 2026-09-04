'use client';

// ── Vera, inside Admin ───────────────────────────────────────────────────────
// The support console: every organisation using Vera, the openings they are
// hiring for, and the candidates against each one.
//
// Three levels, narrowing. That order is not a filing preference — it is the
// order a support question arrives in. Nobody reports "assessment 684253e0 is
// broken"; they say "Acme can't get their link". So you start at the company you
// were told about and narrow until you find the person who is stuck.
//
// Nothing is stored here. Every number comes from Vera through /api/vera, which
// verifies the Firebase user and then calls Vera as a service, naming who it is
// acting for. Admin has no copy of a candidate, a balance or an assessment — a
// second copy would be a second thing to be wrong, and a client's balance is the
// one number that must never be wrong.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { NW, Button, Chip } from '@/components/nw/primitives';

interface Candidate {
  hash: string; name: string; email: string; link: string;
  profileLink: string | null; reportLink: string | null;
  status: string; openingId: string; roleTitle: string; credits: number;
  spokenEnglish: boolean; englishLevel: string | null;
  graded: boolean; consented: boolean;
  createdAt: number; sentAt: number | null; completedAt: number | null;
  expiresAt: number | null; reissuedAt: number | null;
}
interface Opening {
  openingId: string; title: string; seniority: string | null;
  configured: boolean; version: number | null; candidates: Candidate[];
  counts: { total: number; sent: number; started: number; completed: number; expired: number };
}
interface Org {
  id: string; name: string; slug: string | null; balance: number; used: number;
  openings: Opening[];
  counts: { openings: number; candidates: number; completed: number; stuck: number };
}

const STATUS: Record<string, { label: string; variant: 'default' | 'accent' | 'rose' | 'success' | 'warning' | 'blue' }> = {
  not_sent: { label: 'Not sent', variant: 'default' },
  sent: { label: 'Sent', variant: 'blue' },
  started: { label: 'Started', variant: 'warning' },
  in_progress: { label: 'In progress', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  expired: { label: 'Expired', variant: 'rose' },
};

function when(t: number | null) {
  if (!t) return '—';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function VeraPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // Where you are in the tree, held as ids rather than objects so a refresh lands
  // you back on the same screen with new numbers instead of a stale snapshot.
  const [orgId, setOrgId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

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
      const d = await call('support');
      setOrgs(d.organisations ?? []);
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

  const org = useMemo(() => orgs.find((o) => o.id === orgId) ?? null, [orgs, orgId]);
  const opening = useMemo(
    () => org?.openings.find((p) => p.openingId === openingId) ?? null,
    [org, openingId],
  );

  /** Runs an action, then reloads, so the screen always reflects what Vera now holds. */
  const act = useCallback(async (fn: () => Promise<string | null>) => {
    setBusy(true); setError(''); setNote('');
    try {
      const message = await fn();
      if (message) setNote(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const addCredits = (o: Org) => act(async () => {
    const amount = Number(window.prompt(`How many credits for ${o.name}? (currently ${o.balance})`));
    if (!Number.isFinite(amount) || amount === 0) return null;
    const reason = window.prompt('What is this for?') ?? '';
    const d = await call('credits', {
      method: 'POST',
      body: JSON.stringify({ org: o.slug ?? o.id, amount, kind: amount > 0 ? 'granted' : 'adjusted', note: reason }),
    });
    return `${o.name} now has ${d.balance ?? '—'} credits.`;
  });

  const copyLink = (c: Candidate) => act(async () => {
    await navigator.clipboard.writeText(c.link);
    return `Link for ${c.name} copied. It is the same link they already have.`;
  });

  const resend = (c: Candidate) => act(async () => {
    const to = window.prompt(`Resend to which address? Leave as-is to use the one on file.`, c.email);
    if (to === null) return null;
    const d = await call('assessments/resend', {
      method: 'POST',
      body: JSON.stringify({ hash: c.hash, to: to.trim() }),
    });
    return `Sent again to ${d.to}. ${d.note}`;
  });

  const reissue = (c: Candidate) => act(async () => {
    const reason = window.prompt(`New link for ${c.name}. Why is the old one being killed?`);
    if (!reason?.trim()) return null;
    const d = await call(`assessments?hash=${c.hash}`, {
      method: 'PATCH', body: JSON.stringify({ reason }),
    });
    await navigator.clipboard.writeText(d.link).catch(() => {});
    return `New link copied to your clipboard. ${d.note}`;
  });

  const remove = (c: Candidate) => act(async () => {
    const reason = window.prompt(`Delete the assessment for ${c.name}? Say why.`);
    if (!reason?.trim()) return null;
    const d = await call(`assessments?hash=${c.hash}`, {
      method: 'DELETE', body: JSON.stringify({ reason }),
    });
    return `Deleted ${d.candidate}. ${d.note}`;
  });

  // ── chrome ─────────────────────────────────────────────────────────────────
  const crumb = (label: string, onClick: (() => void) | null) => (
    <span
      onClick={onClick ?? undefined}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        color: onClick ? NW.gray500 : NW.black,
        fontWeight: onClick ? 400 : 600,
      }}
    >
      {label}
    </span>
  );

  const card: React.CSSProperties = {
    background: NW.white, border: `1px solid ${NW.gray100}`,
    borderRadius: 12, padding: 20,
  };

  if (loading) {
    return <div style={{ padding: 32, color: NW.gray500 }}>Reading Vera…</div>;
  }

  return (
    <div style={{ padding: 32, background: NW.offWhite, minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6, fontSize: 14 }}>
        {crumb('Organizations', orgId ? () => { setOrgId(null); setOpeningId(null); } : null)}
        {org && <><span style={{ color: NW.gray300 }}>/</span>{crumb(org.name, openingId ? () => setOpeningId(null) : null)}</>}
        {opening && <><span style={{ color: NW.gray300 }}>/</span>{crumb(opening.title, null)}</>}
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 20px' }}>
        {opening ? opening.title : org ? org.name : 'Vera'}
      </h1>

      {error && (
        <div style={{ ...card, borderColor: '#E74C7C40', background: NW.rose50, color: NW.rose600, marginBottom: 16 }}>
          {error}
        </div>
      )}
      {note && (
        <div style={{ ...card, borderColor: '#16A08530', background: NW.teal50, color: NW.teal700, marginBottom: 16 }}>
          {note}
        </div>
      )}

      {/* ── level 1: who is using Vera ─────────────────────────────────────── */}
      {!org && (
        orgs.length === 0
          ? <div style={{ ...card, color: NW.gray500 }}>No organisation has been set up on Vera yet.</div>
          : <div style={{ display: 'grid', gap: 12 }}>
              {orgs.map((o) => (
                <div key={o.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 20 }}>
                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOrgId(o.id)}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{o.name}</div>
                    <div style={{ fontSize: 13, color: NW.gray500, marginTop: 2 }}>
                      {o.counts.openings} opening{o.counts.openings === 1 ? '' : 's'} · {o.counts.candidates} candidate{o.counts.candidates === 1 ? '' : 's'} · {o.counts.completed} completed
                    </div>
                  </div>
                  {/* Started and never finished is the number a support person scans
                      for, so it gets its own chip rather than living in a tooltip. */}
                  {o.counts.stuck > 0 && <Chip variant="warning">{o.counts.stuck} unfinished</Chip>}
                  <div style={{ textAlign: 'right', minWidth: 110 }}>
                    <div style={{ fontSize: 18, fontWeight: 600, color: o.balance < 5 ? NW.rose600 : NW.black }}>
                      {o.balance}
                    </div>
                    <div style={{ fontSize: 12, color: NW.gray500 }}>credits left</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 90 }}>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{o.used}</div>
                    <div style={{ fontSize: 12, color: NW.gray500 }}>used</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setOrgId(o.id)}>Open</Button>
                </div>
              ))}
            </div>
      )}

      {/* ── level 2: what they are hiring for ──────────────────────────────── */}
      {org && !opening && (
        <>
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: NW.gray500 }}>Credits</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: org.balance < 5 ? NW.rose600 : NW.black }}>
                {org.balance} left · {org.used} used
              </div>
            </div>
            <Button size="sm" disabled={busy} onClick={() => void addCredits(org)}>Add or remove credits</Button>
          </div>

          {org.openings.length === 0
            ? <div style={{ ...card, color: NW.gray500 }}>Nothing has been set up for {org.name} yet.</div>
            : <div style={{ display: 'grid', gap: 12 }}>
                {org.openings.map((p) => (
                  <div key={p.openingId} style={{ ...card, display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpeningId(p.openingId)}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{p.title}</div>
                      <div style={{ fontSize: 13, color: NW.gray500, marginTop: 2 }}>
                        {p.counts.total} candidate{p.counts.total === 1 ? '' : 's'}
                        {p.seniority ? ` · ${p.seniority}` : ''}
                        {/* An opening with candidates but no config is a real state —
                            the config was deleted and the assessments outlived it. */}
                        {!p.configured && ' · no configuration on file'}
                      </div>
                    </div>
                    {p.counts.started > 0 && <Chip variant="warning">{p.counts.started} unfinished</Chip>}
                    {p.counts.expired > 0 && <Chip variant="rose">{p.counts.expired} expired</Chip>}
                    {p.counts.completed > 0 && <Chip variant="success">{p.counts.completed} done</Chip>}
                    <Button size="sm" variant="secondary" onClick={() => setOpeningId(p.openingId)}>Open</Button>
                  </div>
                ))}
              </div>}
        </>
      )}

      {/* ── level 3: the person who is stuck ───────────────────────────────── */}
      {opening && (
        opening.candidates.length === 0
          ? <div style={{ ...card, color: NW.gray500 }}>Nobody has been sent this one yet.</div>
          : <div style={{ display: 'grid', gap: 12 }}>
              {opening.candidates.map((c) => {
                const s = STATUS[c.status] ?? { label: c.status, variant: 'default' as const };
                return (
                  <div key={c.hash} style={card}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 13, color: NW.gray500 }}>{c.email}</div>
                      </div>
                      <Chip variant={s.variant}>{s.label}</Chip>
                      {c.englishLevel && <Chip variant="violet">English {c.englishLevel}</Chip>}
                      {c.spokenEnglish && !c.englishLevel && <Chip variant="outline">English pending</Chip>}
                      {c.reissuedAt && <Chip variant="outline">Reissued</Chip>}
                    </div>

                    <div style={{ display: 'flex', gap: 20, fontSize: 12, color: NW.gray500, marginBottom: 12 }}>
                      <span>Sent {when(c.sentAt ?? c.createdAt)}</span>
                      <span>Expires {when(c.expiresAt)}</span>
                      <span>{c.credits} credit{c.credits === 1 ? '' : 's'}</span>
                      <span>{c.consented ? 'Consented' : 'No consent yet'}</span>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {/* Copy first: handing somebody their link is the commonest
                          thing this screen is opened to do. */}
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void copyLink(c)}>
                        Copy link
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void resend(c)}>
                        Resend
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reissue(c)}>
                        New link
                      </Button>
                      {c.reportLink && (
                        <Button size="sm" variant="secondary"
                          onClick={() => window.open(c.reportLink!, '_blank', 'noopener')}>
                          Report
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(c)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
      )}
    </div>
  );
}
