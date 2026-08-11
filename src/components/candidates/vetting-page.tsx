'use client';

// ── Vetting: one candidate, one opening ──────────────────────────────────────
// The internal working record. Everything here — tenure observations, salary
// gaps, a recruiter's private read — stays inside Nearwork. Presenting a
// candidate is vouching for them, so anything that would make a client ask "why
// are you showing me this person?" lives here and stops here.
//
// The notes box is the important control. A form with eight fields gets skipped
// by a busy recruiter; pasting what you already wrote costs nothing.

import { useState, useEffect, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { PageHeader } from '@/components/nw/shell-ui';
import { Button, NW } from '@/components/nw/primitives';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { Check, Minus, AlertTriangle, Sparkles } from 'lucide-react';
import type { VettingRecord, OpeningReqs } from '@/lib/types';
import type { MatchDetail } from '@/lib/candidate-match';

interface Payload {
  record: VettingRecord | null;
  opening: { id: string; title?: string; orgName?: string; reqs?: OpeningReqs } | null;
  candidate: { id: string; name?: string; email?: string } | null;
  match: MatchDetail | null;
  flags: string[];
}

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 18,
};
const label: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: NW.gray400, letterSpacing: '0.09em',
  textTransform: 'uppercase', marginBottom: 8,
};

const REC: Record<string, { text: string; bg: string; fg: string }> = {
  present: { text: 'Present to client', bg: '#ECFDF5', fg: '#047857' },
  hold: { text: 'Hold', bg: '#FFFBEB', fg: '#B45309' },
  reject: { text: 'Reject', bg: '#FEF2F2', fg: '#B91C1C' },
};

function Stars({ n }: { n?: number }) {
  if (typeof n !== 'number') return <span style={{ color: NW.gray300, fontSize: 12.5 }}>not covered</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: i <= n ? NW.teal500 : NW.gray200 }} />
      ))}
    </span>
  );
}

export default function VettingPage({ openingId, candidateId }: { openingId: string; candidateId: string }) {
  const { showToast } = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<'' | 'questions' | 'notes'>('');

  const token = useCallback(async () => auth.currentUser?.getIdToken(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vetting?openingId=${openingId}&candidateId=${candidateId}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const j = await res.json();
      if (res.ok) { setData(j); setNotes(j.record?.notesRaw || ''); }
      else showToast(j.error || 'Could not load', 'error');
    } finally { setLoading(false); }
  }, [openingId, candidateId, token, showToast]);

  useEffect(() => { load(); }, [load]);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch('/api/vetting', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, openingId, candidateId, ...extra }),
    });
    return { res, j: await res.json() };
  }

  async function makeQuestions() {
    setBusy('questions');
    try {
      const { res, j } = await post('questions');
      if (!res.ok) { showToast(j.error || 'Failed', 'error'); return; }
      showToast(`${j.questions.length} questions · $${Number(j.costUsd).toFixed(3)}`, 'success');
      await load();
    } finally { setBusy(''); }
  }

  async function readNotes(force = false) {
    if (!notes.trim()) { showToast('Paste your notes first', 'error'); return; }
    setBusy('notes');
    try {
      const { res, j } = await post('notes', { notes, force });
      if (!res.ok) {
        if (j.needsForce && confirm(`${j.error}\n\nRe-read anyway?`)) { setBusy(''); return readNotes(true); }
        showToast(j.error || 'Failed', 'error');
        return;
      }
      showToast(`Record written · $${Number(j.costUsd).toFixed(3)}`, 'success');
      await load();
    } finally { setBusy(''); }
  }

  const r = data?.record;

  return (
    <MainLayout>
      <PageHeader
        title={`Vetting — ${data?.candidate?.name || '…'}`}
        subtitle={`${data?.opening?.title || ''}${data?.opening?.orgName ? ` · ${data.opening.orgName}` : ''} — internal only, never shown to the client`}
      />

      {loading && <div style={{ ...card, textAlign: 'center', padding: 34 }}><Spinner /></div>}

      {data && !loading && (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* What we know before meeting them, and what to probe */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={card}>
              <div style={label}>Match from their CV</div>
              {data.match ? (
                <>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: NW.black }}>
                    {data.match.score}<span style={{ fontSize: 14, color: NW.gray400, fontWeight: 500 }}>/100</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 4, lineHeight: 1.5 }}>
                    A hypothesis from what they wrote about themselves. Your read after the
                    interview replaces it.
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: NW.gray400 }}>No requirements read for this opening yet.</div>
              )}
            </div>

            <div style={{ ...card, ...(data.flags.length ? { borderColor: '#FDE68A', background: '#FFFBEB' } : {}) }}>
              <div style={label}>Worth asking about</div>
              {data.flags.length ? data.flags.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, fontSize: 12.5, color: '#92400E', marginBottom: 4, lineHeight: 1.5 }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{f}</span>
                </div>
              )) : (
                <div style={{ fontSize: 12.5, color: NW.gray400 }}>Nothing standing out.</div>
              )}
              {!!data.flags.length && (
                <div style={{ fontSize: 11, color: '#92400E', marginTop: 8, opacity: 0.85, lineHeight: 1.5 }}>
                  Questions, not conclusions — and never shown to the client.
                </div>
              )}
            </div>
          </div>

          {/* Questions */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{ ...label, marginBottom: 0 }}>Interview questions</div>
              <Button size="sm" variant={r?.questions?.length ? 'secondary' : 'primary'} onClick={makeQuestions} disabled={!!busy}>
                {busy === 'questions' ? 'Writing…' : r?.questions?.length ? 'Rewrite' : 'Write questions'}
              </Button>
            </div>
            {r?.questions?.length ? (
              <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
                {r.questions.map((q, i) => {
                  const [question, why] = q.split('  —  ');
                  return (
                    <li key={i} style={{ fontSize: 13, color: NW.gray800, lineHeight: 1.55 }}>
                      {question}
                      {why && <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 2 }}>{why}</div>}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div style={{ fontSize: 12.5, color: NW.gray400 }}>
                Built from the must-haves their CV doesn&rsquo;t evidence, plus anything flagged above.
              </div>
            )}
          </div>

          {/* Notes → record */}
          <div style={card}>
            <div style={label}>Interview notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paste whatever you wrote during the interview — fragments and shorthand are fine."
              style={{
                width: '100%', boxSizing: 'border-box', minHeight: 150, resize: 'vertical',
                border: `1px solid ${NW.gray200}`, borderRadius: 10, padding: 12,
                font: 'inherit', fontSize: 13, lineHeight: 1.6, color: NW.black, outline: 'none',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <Button onClick={() => readNotes()} disabled={!!busy}>
                {busy === 'notes' ? 'Reading…' : <><Sparkles size={14} style={{ marginRight: 6 }} />Turn into a record</>}
              </Button>
              <span style={{ fontSize: 11.5, color: NW.gray500 }}>
                Ratings the notes don&rsquo;t cover stay empty rather than being guessed.
              </span>
            </div>
          </div>

          {/* The record */}
          {r?.summary && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div style={{ ...label, marginBottom: 0 }}>The record</div>
                {r.recommendation && (
                  <span style={{
                    fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '4px 12px',
                    background: REC[r.recommendation].bg, color: REC[r.recommendation].fg,
                  }}>{REC[r.recommendation].text}</span>
                )}
              </div>

              <div style={{ fontSize: 13.5, color: NW.gray800, lineHeight: 1.65, marginBottom: 14 }}>{r.summary}</div>
              {r.recommendationReason && (
                <div style={{ fontSize: 12.5, color: NW.gray600, marginBottom: 14, fontStyle: 'italic' }}>
                  {r.recommendationReason}
                </div>
              )}

              <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 16 }}>
                {([['Communication', r.ratings?.communication], ['Role depth', r.ratings?.depth], ['English spoken', r.ratings?.english]] as const).map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10.5, color: NW.gray400, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{k}</div>
                    <Stars n={v} />
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 10.5, color: NW.gray400, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Attendance</div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: r.attendance === 'showed' ? NW.teal700 : '#B45309' }}>
                    {r.attendance === 'no_show' ? 'No-show' : r.attendance === 'late' ? 'Late' : 'Showed up'}
                  </span>
                </div>
              </div>

              {!!r.strengths?.length && (
                <div style={{ marginBottom: 12 }}>
                  <div style={label}>Strengths</div>
                  {r.strengths.map((x, i) => (
                    <div key={i} style={{ display: 'flex', gap: 7, fontSize: 12.5, color: NW.gray700, marginBottom: 4, lineHeight: 1.55 }}>
                      <Check size={13} color="#047857" style={{ flexShrink: 0, marginTop: 2 }} />{x}
                    </div>
                  ))}
                </div>
              )}
              {!!r.concerns?.length && (
                <div style={{ marginBottom: 12 }}>
                  <div style={label}>Concerns</div>
                  {r.concerns.map((x, i) => (
                    <div key={i} style={{ display: 'flex', gap: 7, fontSize: 12.5, color: NW.gray600, marginBottom: 4, lineHeight: 1.55 }}>
                      <Minus size={13} color={NW.gray400} style={{ flexShrink: 0, marginTop: 2 }} />{x}
                    </div>
                  ))}
                </div>
              )}

              {typeof r.fitOverride === 'number' && (
                <div style={{ background: NW.teal50, border: `1px solid ${NW.teal500}33`, borderRadius: 10, padding: '10px 13px' }}>
                  <div style={{ fontSize: 12.5, color: NW.teal700, fontWeight: 600 }}>
                    Your read on fit: {r.fitOverride}/100
                    {data.match && <span style={{ fontWeight: 400, color: NW.gray600 }}> · their CV scored {data.match.score}</span>}
                  </div>
                  {r.fitOverrideReason && (
                    <div style={{ fontSize: 11.5, color: NW.gray600, marginTop: 3 }}>{r.fitOverrideReason}</div>
                  )}
                </div>
              )}

              <div style={{ fontSize: 11, color: NW.gray400, marginTop: 14 }}>
                {r.extractedAt && `Read from notes ${new Date(r.extractedAt).toLocaleString()}`}
                {r.editedBy && ` · edited by ${r.editedBy}`}
              </div>
            </div>
          )}
        </div>
      )}
    </MainLayout>
  );
}
