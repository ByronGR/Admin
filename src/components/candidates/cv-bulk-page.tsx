'use client';

// ── Bulk CV parsing + review ─────────────────────────────────────────────────
// Parses every candidate who has a CV on file, then lets staff check the result
// against the actual document side by side — no downloading anything.

import { useState, useEffect, useCallback } from 'react';
import { auth, db, doc, getDoc } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/nw/shell-ui';
import { Button, NW } from '@/components/nw/primitives';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { Candidate } from '@/lib/types';

interface Row {
  id: string; name: string; email: string; cvUrl: string; parsedAt: string; flags: number;
  flagList?: string[];
}
interface RunResult {
  id: string; name: string; ok: boolean; costUsd?: number; flags?: number; error?: string;
}


// Review flags grouped by cause. Keyword-matched on purpose — deterministic and
// free, and the model reliably names the field it was unsure about.
const THEMES: { key: string; label: string; test: (s: string) => boolean }[] = [
  { key: 'years',    label: 'Years of experience — estimated from dates',
    test: (t) => /yearsexperience|yearsinfunction|years of experience|employment period|overlap/i.test(t) },
  { key: 'seniority',label: 'Seniority — inferred from titles',
    test: (t) => /seniority/i.test(t) },
  { key: 'function', label: 'Function / sub-function — mixed background',
    test: (t) => /function|discipline|classif/i.test(t) },
  { key: 'links',    label: 'Links — anchor text instead of a URL',
    test: (t) => /linkedin|url|portfolio|github|anchor/i.test(t) },
  { key: 'dates',    label: 'Dates on the CV look odd (future / conflicting)',
    test: (t) => /date|future|graduat|endyear|typo/i.test(t) },
  { key: 'education',label: 'Education / certifications',
    test: (t) => /educat|degree|certif|universit|school/i.test(t) },
  { key: 'employer', label: 'Current employer unclear',
    test: (t) => /currentemployer|current employer/i.test(t) },
];

function groupFlags(rows: Row[]) {
  const buckets = THEMES.map((t) => ({ ...t, hits: [] as { name: string; text: string }[] }));
  const other: { name: string; text: string }[] = [];
  for (const r of rows) {
    for (const text of r.flagList || []) {
      const t = buckets.find((b) => b.test(text));
      if (t) t.hits.push({ name: r.name, text });
      else other.push({ name: r.name, text });
    }
  }
  return { buckets: buckets.filter((b) => b.hits.length).sort((a, b) => b.hits.length - a.hits.length), other };
}

const BUILD = 'v6-cap';

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 16, padding: 20,
};
const label: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em',
  textTransform: 'uppercase', marginBottom: 8,
};

export default function CVBulkPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [stopFlag, setStopFlag] = useState(false);
  const [done, setDone] = useState<RunResult[]>([]);
  const [spent, setSpent] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Candidate | null>(null);
  const [idToken, setIdToken] = useState('');
  const [usedToday, setUsedToday] = useState(0);
  const [dailyCap, setDailyCap] = useState(500);

  const token = useCallback(async () => auth.currentUser?.getIdToken(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cv-parse/bulk', { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json();
      if (!res.ok) { showToast(j.error || 'Could not load candidates', 'error'); return; }
      setRows(j.candidates as Row[]);
      setUsedToday(j.usedToday ?? 0);
      setDailyCap(j.dailyCap ?? 500);
    } finally { setLoading(false); }
  }, [token, showToast]);

  useEffect(() => { load(); }, [load]);

  // Batches of 3, looped client-side: keeps each request short, shows live
  // progress, and lets a run be stopped without losing what already saved.
  async function runAll(onlyUnparsed: boolean) {
    const queue = rows.filter((r) => (onlyUnparsed ? !r.parsedAt : true)).map((r) => r.id);
    if (!queue.length) { showToast('Nothing to parse', 'success'); return; }
    setRunning(true); setStopFlag(false); setDone([]); setSpent(0);

    let stopped = false;
    for (let i = 0; i < queue.length && !stopped; i += 3) {
      if (stopFlag) break;
      const batch = queue.slice(i, i + 3);
      try {
        const res = await fetch('/api/cv-parse/bulk', {
          method: 'POST',
          headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
          body: JSON.stringify({ candidateIds: batch }),
        });
        const j = await res.json();
        if (!res.ok) { showToast(j.error || 'Bulk parse failed', 'error'); break; }
        const results = j.results as RunResult[];
        setDone((d) => [...d, ...results]);
        setSpent((s) => s + results.reduce((a, r) => a + (r.costUsd || 0), 0));
        if (results.some((r) => r.error === 'daily limit reached')) {
          showToast('Daily limit reached — resume tomorrow', 'error');
          stopped = true;
        }
      } catch (e) {
        showToast(`Stopped: ${e instanceof Error ? e.message : String(e)}`, 'error');
        break;
      }
    }
    setRunning(false);
    await load();
  }

  async function openDetail(r: Row) {
    setSelected(r); setDetail(null);
    setIdToken((await auth.currentUser?.getIdToken()) || '');
    // The list is long; make sure the panel is actually on screen.
    setTimeout(() => document.getElementById('cv-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    const snap = await getDoc(doc(db, 'candidates', r.id));
    if (snap.exists()) setDetail({ id: snap.id, ...snap.data() } as Candidate);
  }

  const unparsed = rows.filter((r) => !r.parsedAt).length;

  return (
    <MainLayout>
      <PageHeader
        title="Parse all CVs"
        subtitle="Runs the AI parser across every candidate with a CV on file and saves the result to their profile."
      />

      <div style={{ fontSize: 11, color: NW.gray400, marginBottom: 10 }}>
        build <strong style={{ color: NW.gray600 }}>{BUILD}</strong> · if clicking a name does nothing, you&rsquo;re on an older build — hard-refresh with Cmd+Shift+R
      </div>

      <div style={{ ...card, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: NW.black }}>{rows.length}</div>
          <div style={{ fontSize: 12, color: NW.gray500 }}>candidates with a CV</div>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: unparsed ? '#A16207' : NW.teal700 }}>{unparsed}</div>
          <div style={{ fontSize: 12, color: NW.gray500 }}>not parsed yet</div>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: NW.gray700 }}>${(unparsed * 0.04).toFixed(2)}</div>
          <div style={{ fontSize: 12, color: NW.gray500 }}>estimated cost</div>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: (dailyCap - usedToday) < 50 ? '#B91C1C' : NW.gray700 }}>
            {Math.max(0, dailyCap - usedToday)}
          </div>
          <div style={{ fontSize: 12, color: NW.gray500 }}>parses left today</div>
        </div>
        <div style={{ flex: 1 }} />
        {running ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Spinner />
            <div style={{ fontSize: 12.5, color: NW.gray600 }}>
              {done.length} done · ${spent.toFixed(3)} spent
            </div>
            <Button variant="secondary" size="md" onClick={() => setStopFlag(true)}>Stop</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="md" onClick={() => load()}>
              <RefreshCw size={13} /> Refresh
            </Button>
            <Button variant="primary" size="md" disabled={!unparsed} onClick={() => runAll(true)}>
              Parse {unparsed} remaining
            </Button>
            {/* Re-parse picks up prompt improvements (better skill recall,
                education, the certification fix) on candidates already done.
                Safe to repeat: the patch only writes non-empty values, so
                hand-curated fields survive. */}
            <Button
              variant="secondary"
              size="md"
              disabled={!rows.length}
              onClick={() => {
                if (confirm(`Re-parse all ${rows.length} candidates? About $${(rows.length * 0.04).toFixed(2)}. Existing hand-edited fields are not overwritten.`)) {
                  runAll(false);
                }
              }}
            >
              Re-parse all {rows.length}
            </Button>
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={label}>This run — {done.length} processed · ${spent.toFixed(3)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {done.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                {r.ok
                  ? <CheckCircle2 size={14} color={NW.teal600} />
                  : <AlertTriangle size={14} color="#B91C1C" />}
                <span style={{ fontWeight: 500 }}>{r.name}</span>
                {r.ok
                  ? <span style={{ color: NW.gray500 }}>
                      ${r.costUsd?.toFixed(4)}{r.flags ? ` · ${r.flags} to review` : ''}
                    </span>
                  : <span style={{ color: '#B91C1C' }}>{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What the parser was unsure about, across the whole database. Grouping
          by cause turns 300+ individual notes into a handful of decisions. */}
      {(() => {
        const { buckets, other } = groupFlags(rows);
        const total = buckets.reduce((n, b) => n + b.hits.length, 0) + other.length;
        if (!total) return null;
        return (
          <div style={{ ...card, marginTop: 16 }}>
            <div style={label}>Review flags — {total} across {rows.filter((r) => r.flags).length} candidates</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {buckets.map((b) => (
                <details key={b.key} style={{ border: `1px solid ${NW.gray100}`, borderRadius: 10, padding: '10px 12px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, color: NW.black }}>
                    <strong>{b.hits.length}</strong> · {b.label}
                    <span style={{ color: NW.gray400, fontSize: 11.5 }}>
                      {' '}({Math.round((b.hits.length / total) * 100)}% of all flags)
                    </span>
                  </summary>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
                    {b.hits.slice(0, 40).map((h, i) => (
                      <div key={i} style={{ fontSize: 12, color: NW.gray700 }}>
                        <strong style={{ color: NW.gray800 }}>{h.name}</strong> — {h.text}
                      </div>
                    ))}
                    {b.hits.length > 40 && (
                      <div style={{ fontSize: 11.5, color: NW.gray400 }}>…and {b.hits.length - 40} more</div>
                    )}
                  </div>
                </details>
              ))}
              {other.length > 0 && (
                <details style={{ border: `1px solid ${NW.gray100}`, borderRadius: 10, padding: '10px 12px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, color: NW.black }}>
                    <strong>{other.length}</strong> · Everything else
                  </summary>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
                    {other.slice(0, 40).map((h, i) => (
                      <div key={i} style={{ fontSize: 12, color: NW.gray700 }}>
                        <strong style={{ color: NW.gray800 }}>{h.name}</strong> — {h.text}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        );
      })()}

      {/* Side-by-side review: the CV itself next to what we pulled out of it. */}
      {selected && (
        <div id="cv-review" style={{ ...card, marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: NW.black }}>{selected.name}</div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
            <div>
              <div style={label}>The CV</div>
              <iframe
                src={`/api/cv-file/${selected.id}?t=${idToken}`}
                title="CV"
                style={{ width: '100%', height: 620, border: `1px solid ${NW.gray200}`, borderRadius: 10, background: NW.gray50 }}
              />
              <a href={`/api/cv-file/${selected.id}?t=${idToken}`} target="_blank" rel="noopener noreferrer"
                 style={{ fontSize: 11.5, color: NW.teal700, marginTop: 6, display: 'inline-block' }}>
                Open in a new tab
              </a>
            </div>
            <div style={{ maxHeight: 620, overflowY: 'auto', paddingRight: 4 }}>
              <div style={label}>What we extracted</div>
              {!detail ? <Spinner /> : (
                <div style={{ fontSize: 12.5, color: NW.gray800, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {detail.cvParse?.lowConfidence?.length ? (
                    <div style={{ padding: 10, borderRadius: 9, background: '#FFF8EC', border: '1px solid #F39C1233' }}>
                      <div style={{ fontWeight: 700, color: '#A16207', marginBottom: 4 }}>Needs review</div>
                      <ul style={{ margin: '0 0 0 16px' }}>
                        {detail.cvParse.lowConfidence.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  <div><strong>{detail.headline || detail.role}</strong></div>
                  <div style={{ color: NW.gray500 }}>
                    {[detail.function, detail.subFunction, detail.seniority].filter(Boolean).join(' · ')}
                    {detail.experience != null && ` · ${detail.experience} yrs`}
                  </div>
                  {detail.summary && <div>{detail.summary}</div>}
                  {!!detail.skills?.length && <div><strong>Skills:</strong> {detail.skills.join(', ')}</div>}
                  {!!detail.tools?.length && <div><strong>Tools:</strong> {detail.tools.join(', ')}</div>}
                  {!!detail.workHistory?.length && (
                    <div>
                      <strong>Work history</strong>
                      {detail.workHistory.map((w, i) => (
                        <div key={i} style={{ marginTop: 7, paddingLeft: 10, borderLeft: `2px solid ${NW.gray100}` }}>
                          <div style={{ fontWeight: 600 }}>{w.title}</div>
                          <div style={{ color: NW.gray500 }}>
                            {[w.company, [w.from, w.to].filter(Boolean).join(' – '), w.location].filter(Boolean).join(' · ')}
                          </div>
                          {w.accomplishments?.map((a, j) => (
                            <div key={j} style={{ color: NW.teal700, marginTop: 3 }}>★ {a}</div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {!!detail.certifications?.length && (
                    <div><strong>Certifications:</strong> {detail.certifications.map((c) => c.name).join(', ')}</div>
                  )}
                  {!!detail.languages?.length && (
                    <div><strong>Languages:</strong> {detail.languages.join(', ')}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div style={{ ...card, marginTop: 16 }}>
        <div style={label}>Candidates</div>
        {loading ? <Spinner /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 420, overflowY: 'auto' }}>
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => openDetail(r)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  border: 'none', background: selected?.id === r.id ? NW.gray50 : 'transparent',
                  borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontSize: 12.5,
                }}
              >
                <span style={{ flex: 1, fontWeight: 500, color: NW.black }}>{r.name}</span>
                <span style={{ color: NW.gray400, fontSize: 11.5 }}>{r.email}</span>
                {r.flags > 0 && (
                  <span style={{ fontSize: 10.5, color: '#A16207', background: '#FFF8EC', padding: '2px 8px', borderRadius: 999 }}>
                    {r.flags} to review
                  </span>
                )}
                <span style={{
                  fontSize: 10.5, padding: '2px 8px', borderRadius: 999,
                  color: r.parsedAt ? NW.teal700 : NW.gray500,
                  background: r.parsedAt ? NW.teal50 : NW.gray50,
                }}>
                  {r.parsedAt ? 'parsed' : 'not parsed'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

    </MainLayout>
  );
}
