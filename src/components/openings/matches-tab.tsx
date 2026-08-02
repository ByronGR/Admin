'use client';

// ── "Talent we already have" ─────────────────────────────────────────────────
// Ranks every candidate in the database against this opening. Two steps, because
// they cost differently: reading the requirements is one AI call (~1c), and
// matching against them is free, so re-ranking is instant and unlimited.
//
// Every row shows its reasoning. A score nobody can argue with is a score nobody
// trusts — the matched and missing lists are the point, not the number.

import { useState, useEffect, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { useToast } from '@/components/ui/toast';
import { Button, NW } from '@/components/nw/primitives';
import { Spinner } from '@/components/ui/spinner';
import { Sparkles, Check, AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import type { Opening, OpeningReqs } from '@/lib/types';
import type { MatchDetail } from '@/lib/candidate-match';

interface MatchResponse {
  reqs: OpeningReqs;
  scanned: number;
  alreadyInPipeline: number;
  matches: MatchDetail[];
  counts: { strong: number; possible: number; stretch: number };
}

const BAND: Record<MatchDetail['band'], { label: string; bg: string; fg: string }> = {
  strong:   { label: 'Strong',   bg: '#ECFDF5', fg: '#047857' },
  possible: { label: 'Possible', bg: '#FFFBEB', fg: '#B45309' },
  stretch:  { label: 'Stretch',  bg: '#F8FAFC', fg: '#64748B' },
};

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 18,
};
const label: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.09em',
  textTransform: 'uppercase', marginBottom: 7,
};

function Chips({ items, tone }: { items: string[]; tone: 'good' | 'bad' | 'plain' }) {
  const style = tone === 'good'
    ? { background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0' }
    : tone === 'bad'
      ? { background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }
      : { background: NW.gray50, color: NW.gray600, border: `1px solid ${NW.gray100}` };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((s) => (
        <span key={s} style={{ ...style, fontSize: 11.5, padding: '3px 9px', borderRadius: 999, fontWeight: 600 }}>{s}</span>
      ))}
    </div>
  );
}

export function MatchesTab({ op }: { op: Opening }) {
  const { showToast } = useToast();
  const [reqs, setReqs] = useState<OpeningReqs | undefined>(op.reqs);
  const [data, setData] = useState<MatchResponse | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState('');

  const token = useCallback(async () => auth.currentUser?.getIdToken(), []);

  const runMatch = useCallback(async () => {
    setMatching(true); setError('');
    try {
      const res = await fetch(`/api/opening-match?openingId=${op.id}&limit=40`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const j = await res.json();
      if (!res.ok) {
        // Not an error worth shouting about — it just means step one hasn't run.
        if (!j.needsExtract) setError(j.error || 'Matching failed');
        return;
      }
      setData(j as MatchResponse);
      setReqs(j.reqs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMatching(false);
    }
  }, [op.id, token]);

  useEffect(() => { if (reqs) runMatch(); }, [reqs, runMatch]);

  async function extract(force = false) {
    setExtracting(true); setError('');
    try {
      const res = await fetch(`/api/opening-parse${force ? '?force=1' : ''}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ openingId: op.id }),
      });
      const j = await res.json();
      if (!res.ok) {
        if (j.needsForce && confirm(`${j.error}\n\nRe-extract anyway?`)) { setExtracting(false); return extract(true); }
        setError(j.error || 'Could not read the requirements');
        return;
      }
      setReqs(j.reqs as OpeningReqs);
      showToast(`Requirements read · $${Number(j.costUsd).toFixed(3)}`, 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  // ── Step one hasn't run ────────────────────────────────────────────────────
  if (!reqs) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: 44 }}>
        <Sparkles size={26} color={NW.teal500} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 17, fontWeight: 700, color: NW.black, marginBottom: 6 }}>
          Who do we already have for this role?
        </div>
        <div style={{ fontSize: 13.5, color: NW.gray500, maxWidth: 460, margin: '0 auto 18px', lineHeight: 1.55 }}>
          Reads what this opening actually needs, then ranks every candidate in the database against it.
          Costs about a cent, once. Matching after that is free.
        </div>
        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, marginBottom: 14, textAlign: 'left' }}>
            {error}
          </div>
        )}
        <Button onClick={() => extract()} disabled={extracting}>
          {!extracting && <Sparkles size={14} style={{ marginRight: 6 }} />}
          {extracting ? 'Reading the opening…' : 'Find requirements'}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* What we understood the role to need — editable by eye, not a black box */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={label}>What this role needs</div>
            {reqs.summary && <div style={{ fontSize: 14, color: NW.black, fontWeight: 600 }}>{reqs.summary}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => extract(true)} disabled={extracting}>
            <RefreshCw size={13} style={{ marginRight: 5 }} />
            {extracting ? 'Reading…' : 'Re-read'}
          </Button>
        </div>

        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 16 }}>
          {[
            ['Discipline', (reqs.function || '—').replace(/_/g, ' ')],
            ['Specialism', (reqs.subFunction || '—').replace(/_/g, ' ')],
            ['Seniority', (reqs.seniority || '—').replace(/_/g, ' ')],
            ['Experience', reqs.yearsRequired != null ? `${reqs.yearsRequired} yrs` : 'Not stated'],
            ['English', reqs.englishRequired || 'Not stated'],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 10.5, color: NW.gray400, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{k}</div>
              <div style={{ fontSize: 13.5, color: NW.gray700, fontWeight: 600, textTransform: 'capitalize' }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {!!reqs.mustHaveSkills?.length && (
            <div>
              <div style={label}>Must have</div>
              <Chips items={reqs.mustHaveSkills} tone="good" />
            </div>
          )}
          {!!reqs.niceToHaveSkills?.length && (
            <div>
              <div style={label}>Nice to have</div>
              <Chips items={reqs.niceToHaveSkills} tone="plain" />
            </div>
          )}
          {!!reqs.tools?.length && (
            <div>
              <div style={label}>Tools</div>
              <Chips items={reqs.tools} tone="plain" />
            </div>
          )}
        </div>

        {!!reqs.notes?.length && (
          <div style={{ marginTop: 14, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 13px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 5 }}>Worth confirming with the client</div>
            {reqs.notes.map((n, i) => (
              <div key={i} style={{ fontSize: 12.5, color: '#92400E', lineHeight: 1.5 }}>· {n}</div>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      {matching && !data && (
        <div style={{ ...card, textAlign: 'center', padding: 36 }}><Spinner /></div>
      )}

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {data && (
        <>
          <div style={{ ...card, display: 'flex', gap: 26, alignItems: 'center', flexWrap: 'wrap' }}>
            {([['strong', data.counts.strong], ['possible', data.counts.possible], ['stretch', data.counts.stretch]] as const).map(([b, n]) => (
              <div key={b}>
                <div style={{ fontSize: 24, fontWeight: 700, color: BAND[b].fg }}>{n}</div>
                <div style={{ fontSize: 12, color: NW.gray500 }}>{BAND[b].label.toLowerCase()}</div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', fontSize: 12, color: NW.gray400, textAlign: 'right' }}>
              {data.scanned} candidates scanned
              {data.alreadyInPipeline > 0 && <><br />{data.alreadyInPipeline} already in this pipeline</>}
            </div>
          </div>

          {!data.matches.length && (
            <div style={{ ...card, textAlign: 'center', padding: 34, color: NW.gray500, fontSize: 13.5 }}>
              Nobody in the database is a reasonable fit for this one. Worth sourcing.
            </div>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            {data.matches.map((m) => (
              <div key={m.candidateId} style={{ ...card, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{
                    minWidth: 46, height: 46, borderRadius: 11, display: 'grid', placeItems: 'center',
                    background: BAND[m.band].bg, color: BAND[m.band].fg, fontWeight: 800, fontSize: 16,
                  }}>{m.score}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: NW.black }}>{m.name}</div>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, color: BAND[m.band].fg, background: BAND[m.band].bg,
                      padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>{BAND[m.band].label}</span>
                  </div>
                  <a href={`/candidates/${m.candidateId}`} target="_blank" rel="noopener noreferrer"
                     style={{ fontSize: 12.5, color: NW.teal700, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Open profile <ExternalLink size={12} />
                  </a>
                </div>

                {m.reasons.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 7, fontSize: 12.5, color: NW.gray600, marginBottom: 4, lineHeight: 1.5 }}>
                    <Check size={13} color="#047857" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{r}</span>
                  </div>
                ))}
                {m.cautions.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 7, fontSize: 12.5, color: '#92400E', marginBottom: 4, lineHeight: 1.5 }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
