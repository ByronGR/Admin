'use client';

// ── "Talent we already have" ─────────────────────────────────────────────────
// Ranks every candidate in the database against this opening. Two steps, because
// they cost differently: reading the requirements is one AI call (~1c), and
// matching against them is free, so re-ranking is instant and unlimited.
//
// Every row shows its reasoning. A score nobody can argue with is a score nobody
// trusts — the matched and missing lists are the point, not the number.

import { useState, useEffect, useCallback } from 'react';
import { auth, db, doc, getDoc, updateDoc, arrayUnion, serverTimestamp } from '@/lib/firebase';
import { useToast } from '@/components/ui/toast';
import { Button, NW } from '@/components/nw/primitives';
import { Spinner } from '@/components/ui/spinner';
import { Sparkles, Check, Minus, RefreshCw, ExternalLink, Search } from 'lucide-react';
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
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());

  // The API applies a >= 25 noise floor. Honour it only while it still leaves a
  // screenful — on a thin bench a near-empty tab is worse than a few stretches,
  // and every card says plainly how weak it is.
  const filtered = (data?.matches || []).filter((m) =>
    !q.trim() || `${m.name} ${m.role || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const strongEnough = filtered.filter((m) => m.score >= 25);
  // Sorted here as well as server-side: the order is the whole point of the tab,
  // and it shouldn't depend on a caller preserving it.
  const shown = (strongEnough.length >= 8 ? strongEnough : filtered)
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  async function addToPipeline(m: MatchDetail) {
    setAdding((s) => new Set(s).add(m.candidateId));
    try {
      // The pipeline doc id is the opening code, same convention as everywhere else.
      const code = op.code || op.id;
      const snap = await getDoc(doc(db, 'candidates', m.candidateId));
      const c = snap.exists() ? snap.data() as Record<string, unknown> : {};
      await updateDoc(doc(db, 'pipelines', code), {
        candidates: arrayUnion({
          candidateId: m.candidateId,
          candidateCode: m.candidateId,
          name: m.name,
          email: (c.email as string) || '',
          stage: op.pipelineType === 'sourcing' ? 'sourced' : 'applied',
          addedAt: new Date().toISOString(),
          source: 'Talent we have',
          score: m.score,
        }),
        updatedAt: serverTimestamp(),
      });
      setAdded((s) => new Set(s).add(m.candidateId));
      showToast(`${m.name} added to the pipeline`, 'success');
    } catch (e) {
      showToast('Could not add: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setAdding((s) => { const n = new Set(s); n.delete(m.candidateId); return n; });
    }
  }

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

          {/* Search the bench by name or role. */}
          <div style={{ position: 'relative' }}>
            <Search size={15} color={NW.gray400} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search these matches by name or role…"
              style={{ width: '100%', boxSizing: 'border-box', height: 40, borderRadius: 10, border: `1px solid ${NW.gray200}`, padding: '0 12px 0 34px', font: 'inherit', fontSize: 13, color: NW.black, outline: 'none', background: NW.white }}
            />
          </div>

          {!shown.length && (
            <div style={{ ...card, textAlign: 'center', padding: 34, color: NW.gray500, fontSize: 13.5 }}>
              Nobody in the database is a reasonable fit for this one. Worth sourcing.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
            {shown.map((m) => (
              <div key={m.candidateId} style={{ background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 15, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 11 }}>
                  <span style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: BAND[m.band].fg, color: '#fff', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {(m.name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                    <div style={{ fontSize: 11.5, color: NW.gray500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[m.role, m.location].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: BAND[m.band].fg, background: BAND[m.band].bg, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                    {BAND[m.band].label} · {m.score}
                  </span>
                </div>

                <div style={{ flex: 1 }}>
                  {m.reasons.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 7, fontSize: 11.5, color: NW.gray600, marginBottom: 4, lineHeight: 1.5 }}>
                      <Check size={13} color="#047857" style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{r}</span>
                    </div>
                  ))}
                  {/* Two cautions at most — a card that lists every doubt reads as
                      a rejection, and the profile is one click away. */}
                  {m.cautions.slice(0, 2).map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: 7, fontSize: 11.5, color: NW.gray500, marginBottom: 4, lineHeight: 1.5 }}>
                      <Minus size={13} color={NW.gray400} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{c}</span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 11, borderTop: `1px solid ${NW.gray100}` }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: NW.gray500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[m.expectedSalary, m.years != null ? `${m.years} yrs` : ''].filter(Boolean).join(' · ') || 'No salary on file'}
                  </span>
                  <a href={`/candidates/${m.candidateId}`} target="_blank" rel="noopener noreferrer"
                     style={{ flexShrink: 0, fontSize: 11.5, color: NW.gray500, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Profile <ExternalLink size={11} />
                  </a>
                  <button
                    onClick={() => addToPipeline(m)}
                    disabled={adding.has(m.candidateId) || added.has(m.candidateId)}
                    style={{ flexShrink: 0, font: 'inherit', fontSize: 11.5, fontWeight: 600, color: added.has(m.candidateId) ? NW.gray400 : NW.teal700, background: added.has(m.candidateId) ? NW.gray50 : NW.teal50, border: `1px solid ${added.has(m.candidateId) ? NW.gray200 : NW.teal500 + '33'}`, borderRadius: 999, padding: '5px 12px', cursor: adding.has(m.candidateId) || added.has(m.candidateId) ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {added.has(m.candidateId) ? 'Added' : adding.has(m.candidateId) ? 'Adding…' : 'Add to pipeline'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
