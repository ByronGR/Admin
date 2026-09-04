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
interface Bank { id: string; title: string; lengths: number[]; createdAt: number }
interface Opening {
  openingId: string; title: string; seniority: string | null;
  configured: boolean; version: number | null; banks: Bank[]; candidates: Candidate[];
  counts: { total: number; sent: number; started: number; completed: number; expired: number };
}
interface OpenOrder {
  id: string; credits: number; amount: number; currency: string;
  note: string | null; link: string | null; createdBy: string; createdAt: number;
}
interface Org {
  id: string; name: string; slug: string | null; balance: number; used: number;
  openings: Opening[]; openOrders: OpenOrder[];
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

/**
 * Send one candidate an assessment, without leaving Admin.
 *
 * A real form rather than a chain of prompts: this has six fields, and a prompt
 * chain gives no way back from the third one. It also cannot show the thing that
 * actually matters here — that sending is free, and the credit is only spent when
 * the candidate starts.
 */
function SendForm({ org, opening, onSend, busy }: {
  org: Org; opening: Opening;
  onSend: (body: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState(org.name);
  const [bankId, setBankId] = useState(opening.banks[0]?.id ?? '');
  const bank = opening.banks.find((b) => b.id === bankId) ?? opening.banks[0];
  // The longest the chosen set can actually support. Offering 6 when the bank has
  // four situations produces a refusal at the end of the form rather than the start.
  const lengths = bank?.lengths ?? [];
  const [length, setLength] = useState<number>(lengths[lengths.length - 1] ?? 4);
  const [expiryDays, setExpiryDays] = useState(14);
  const [send, setSend] = useState(true);

  useEffect(() => {
    const ls = opening.banks.find((b) => b.id === bankId)?.lengths ?? [];
    if (ls.length && !ls.includes(length)) setLength(ls[ls.length - 1]);
  }, [bankId, opening.banks, length]);

  const field: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: 14, borderRadius: 8,
    border: `1px solid ${NW.gray200}`, background: NW.white, color: NW.black,
  };
  const label: React.CSSProperties = { fontSize: 12, color: NW.gray500, marginBottom: 4, display: 'block' };
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && !!bankId;

  return (
    <div style={{
      background: NW.white, border: `1px solid ${NW.gray100}`,
      borderRadius: 12, padding: 20, marginBottom: 16,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Send this assessment</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={label}>Their name</label>
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Diego Ramirez" />
        </div>
        <div>
          <label style={label}>Their email</label>
          <input style={field} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="diego@example.com" />
        </div>
        <div>
          <label style={label}>Company they applied to</label>
          <input style={field} value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <div>
          <label style={label}>Question set</label>
          <select style={field} value={bankId} onChange={(e) => setBankId(e.target.value)}>
            {opening.banks.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>How many situations</label>
          <select style={field} value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {lengths.map((n) => <option key={n} value={n}>{n} situations</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Link expires in</label>
          <select style={field} value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))}>
            {[7, 14, 30].map((n) => <option key={n} value={n}>{n} days</option>)}
          </select>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 14 }}>
        <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
        Email it to them now
        <span style={{ color: NW.gray500, fontSize: 13 }}>
          — otherwise the link is made and you send it yourself
        </span>
      </label>

      {/* Sending is free; the credit goes when they start. Somebody with an empty
          balance can still send, and would find out only when the candidate hits a
          wall — so say it here instead. */}
      {org.balance < 1 && (
        <div style={{
          background: NW.rose50, color: NW.rose600, border: '1px solid #E74C7C40',
          borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 14,
        }}>
          {org.name} has no credits left. The link will be created and sent, but they
          will not be able to start until you add some.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          disabled={!valid || busy}
          onClick={() => void onSend({
            bankId, candidateName: name.trim(), candidateEmail: email.trim(),
            companyName: company.trim() || org.name,
            length, expiryDays, send,
          })}
        >
          {send ? 'Create and send' : 'Create the link'}
        </Button>
        <span style={{ fontSize: 13, color: NW.gray500 }}>
          Free to send. One credit is spent only when they start.
        </span>
      </div>
    </div>
  );
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
  const [sending, setSending] = useState(false);

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

  const sendAssessment = (body: Record<string, unknown>) => act(async () => {
    const d = await call('assessments', { method: 'POST', body: JSON.stringify(body) });
    setSending(false);
    await navigator.clipboard.writeText(d.link).catch(() => {});
    // The email result is reported separately from the link being made, because
    // they fail separately: a link that exists and an email that did not go out is
    // a recoverable situation, and one you can only recover from if you are told.
    const mail = d.email
      ? (d.email.sent ? 'The invitation went out.' : `The email did NOT go out: ${d.email.error}`)
      : 'No email was sent — hand them the link yourself.';
    return `Link created and copied to your clipboard. ${mail}`;
  });

  const charge = (o: Org) => act(async () => {
    const credits = Number(window.prompt(`How many credits is ${o.name} buying?`));
    if (!Number.isFinite(credits) || credits <= 0) return null;
    const amountUsd = Number(window.prompt(`What are they paying, in USD, for ${credits} credits?`));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
    const note = window.prompt('Anything to put on the invoice? (optional)') ?? '';
    const d = await call('credits/checkout', {
      method: 'POST',
      body: JSON.stringify({ org: o.slug ?? o.id, credits, amountUsd, note }),
    });
    await navigator.clipboard.writeText(d.url).catch(() => {});
    // Prompted as well as copied, because this link is the thing being sent to a
    // paying client and losing it to a clipboard that did not take is expensive.
    window.prompt('Payment link — copied, send it to them:', d.url);
    return d.note;
  });

  const cancelOrder = (o: OpenOrder) => act(async () => {
    if (!window.confirm(
      `Cancel the ${o.currency} ${o.amount.toFixed(2)} invoice for ${o.credits} credit${o.credits === 1 ? '' : 's'}?\n\nThe link stops working. Nobody has been charged.`
    )) return null;
    const d = await call(`credits/checkout?order=${o.id}`, { method: 'DELETE' });
    return d.note;
  });

  const copyOrderLink = (o: OpenOrder) => act(async () => {
    if (!o.link) return 'That order has no link — it never reached Stripe.';
    await navigator.clipboard.writeText(o.link);
    return 'Payment link copied.';
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
        {crumb('Organizations', orgId ? () => { setOrgId(null); setOpeningId(null); setSending(false); } : null)}
        {org && <><span style={{ color: NW.gray300 }}>/</span>{crumb(org.name, openingId ? () => { setOpeningId(null); setSending(false); } : null)}</>}
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
            <Button size="sm" disabled={busy} onClick={() => void charge(org)}>Charge for credits</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void addCredits(org)}>
              Add by hand
            </Button>
          </div>

          {org.openOrders.length > 0 && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                Waiting to be paid
              </div>
              <div style={{ fontSize: 13, color: NW.gray500, marginBottom: 12 }}>
                Sent, not paid. No credits have been added and nobody has been charged.
              </div>
              {org.openOrders.map((o) => (
                <div key={o.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0', borderTop: `1px solid ${NW.gray100}`,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14 }}>
                      {o.credits} credit{o.credits === 1 ? '' : 's'} — {o.currency} {o.amount.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 12, color: NW.gray500 }}>
                      {o.note ? `${o.note} · ` : ''}sent {new Date(o.createdAt).toLocaleDateString()} by {o.createdBy}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={busy || !o.link}
                    onClick={() => void copyOrderLink(o)}>
                    Copy link
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => void cancelOrder(o)}>
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          )}

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
      {opening && org && (
        <div style={{ marginBottom: 16 }}>
          {opening.banks.length === 0 ? (
            <div style={{ ...card, color: NW.gray500 }}>
              There is no finished question set for this opening, so nothing can be
              sent for it yet.
            </div>
          ) : sending ? (
            <SendForm org={org} opening={opening} busy={busy} onSend={sendAssessment} />
          ) : (
            <Button onClick={() => { setSending(true); setNote(''); setError(''); }}>
              Send this assessment to someone
            </Button>
          )}
        </div>
      )}

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
