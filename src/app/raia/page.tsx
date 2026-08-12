'use client';

// ── RAIA in Admin ─────────────────────────────────────────────────────────────
// Pick an opening, pick a candidate on it, get the interview brief.
//
// Deliberately a page of its own rather than a button inside the pipeline
// board: the board is 2,400 lines of live production code and this is the first
// time RAIA has ever run against real data. When the brief has proved itself on
// real openings, the pipeline can deep-link straight into it.
//
// Everything here is read-only. Nothing this page does changes a candidate, an
// opening or a pipeline.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth, db, collection, getDocs } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { NW, Icon } from '@/components/nw/primitives';
import type { Opening, Pipeline } from '@/lib/types';

interface GapEntry {
  id: string;
  requirement: string;
  weight: 'must_have' | 'nice_to_have';
  gapType: string;
  roleAsks: string;
  cvSays: string;
  why?: string;
  probeQuestions: string[];
}

interface RoleQuestion {
  question: string;
  followUp: string;
  why: string;
  tests: string;
  dealBreaker: boolean;
}

interface BriefResponse {
  written?: boolean;
  roleBriefCached?: boolean;
  reqsExtractedNow?: boolean;
  mustHaveCount?: number;
  hasCvText?: boolean;
  roleBrief?: {
    roleReallyNeeds: string;
    coreQuestions: RoleQuestion[];
    goodLooksLike: string[];
    commonOverclaims: string[];
  } | null;
  gapMap?: {
    beforeYouDialIn?: string;
    briefing: string[];
    entries: GapEntry[];
    confirmed: Array<{ requirement: string }>;
    notAssessed: string[];
  };
  error?: string;
}

const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: NW.gray400,
  marginBottom: 10,
};

const card: React.CSSProperties = {
  border: `1px solid ${NW.gray100}`,
  borderRadius: 12,
  background: NW.white,
  padding: '16px 18px',
};

export default function RaiaAdminPage() {
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);

  const [openingId, setOpeningId] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BriefResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [openSnap, pipeSnap] = await Promise.all([
        getDocs(collection(db, 'openings')),
        getDocs(collection(db, 'pipelines')),
      ]);
      setOpenings(
        openSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Opening)
          .filter((o) => o.status !== 'cancelled')
          .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
      );
      setPipelines(pipeSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Pipeline));
      setLoading(false);
    })();
  }, []);

  // The pipeline for the chosen opening, and the people on it. A brief needs a
  // candidate who is actually up for this role, not any candidate in the system.
  const pipeline = useMemo(
    () => pipelines.find((p) => p.openingId === openingId),
    [pipelines, openingId],
  );
  const candidates = useMemo(() => pipeline?.candidates ?? [], [pipeline]);

  const run = useCallback(async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/raia/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId, openingId, pipelineId: pipeline?.id }),
      });
      const json = (await res.json()) as BriefResponse;
      if (!res.ok) setError(json.error || `Failed (${res.status})`);
      else setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [candidateId, openingId, pipeline]);

  const gm = result?.gapMap;

  return (
    <MainLayout>
      <div style={{ maxWidth: 860 }}>
        <header style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.025em', color: NW.black }}>
            RAIA
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 13.5, color: NW.gray500 }}>
            An interview brief from the CV against the job description. Read-only — nothing here
            changes a candidate or an opening.
          </p>
        </header>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spinner />
          </div>
        ) : (
          <>
            {/* ── Pick ────────────────────────────────────────────────────── */}
            <div style={{ ...card, marginBottom: 18 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={LABEL}>Opening</div>
                  <select
                    value={openingId}
                    onChange={(e) => {
                      setOpeningId(e.target.value);
                      setCandidateId('');
                      setResult(null);
                    }}
                    style={{
                      width: '100%', height: 38, padding: '0 10px', borderRadius: 9,
                      border: `1px solid ${NW.gray200}`, background: NW.white, fontSize: 13.5,
                    }}
                  >
                    <option value="">Choose an opening…</option>
                    {openings.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                        {o.orgName ? ` · ${o.orgName}` : ''}
                        {o.reqs ? '' : '  (no requirements yet)'}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={LABEL}>Candidate</div>
                  <select
                    value={candidateId}
                    onChange={(e) => {
                      setCandidateId(e.target.value);
                      setResult(null);
                    }}
                    disabled={!openingId}
                    style={{
                      width: '100%', height: 38, padding: '0 10px', borderRadius: 9,
                      border: `1px solid ${NW.gray200}`, background: NW.white, fontSize: 13.5,
                      color: openingId ? NW.black : NW.gray400,
                    }}
                  >
                    <option value="">
                      {!openingId
                        ? 'Pick an opening first'
                        : candidates.length
                          ? 'Choose a candidate…'
                          : 'Nobody on this pipeline yet'}
                    </option>
                    {candidates.map((c) => (
                      <option key={c.candidateId} value={c.candidateId}>
                        {c.name} · {c.stage}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={run}
                  disabled={!openingId || !candidateId || busy}
                  style={{
                    height: 38, padding: '0 18px', borderRadius: 9, border: 'none',
                    background: !openingId || !candidateId || busy ? NW.gray200 : NW.teal500,
                    color: NW.white, fontSize: 13, fontWeight: 600,
                    cursor: !openingId || !candidateId || busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  {busy ? 'Reading…' : 'Prepare brief'}
                </button>
              </div>
            </div>

            {error && (
              <div
                style={{
                  ...card, marginBottom: 18,
                  background: NW.rose50, border: `1px solid #F8CEDC`, color: NW.rose600, fontSize: 13.5,
                }}
              >
                {error}
              </div>
            )}

            {result && gm && (
              <>
                {/* ── What we were working with ───────────────────────────── */}
                <div
                  style={{
                    ...card, marginBottom: 18,
                    display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12.5, color: NW.gray600,
                  }}
                >
                  <span>
                    <Icon name={result.hasCvText ? 'check' : 'triangle-alert'} size={13} color={result.hasCvText ? NW.teal600 : NW.yellow500} />{' '}
                    {result.hasCvText ? 'CV text available' : 'No CV text — gaps may be overstated'}
                  </span>
                  <span>{result.mustHaveCount} must-haves on the opening</span>
                  {result.reqsExtractedNow && <span>Requirements read just now</span>}
                  <span>{result.roleBriefCached ? 'Role brief reused (free)' : 'Role brief written'}</span>
                  {result.written === false && <span style={{ color: NW.rose600 }}>Questions not written by AI</span>}
                </div>

                {/* ── Before you dial in ──────────────────────────────────── */}
                {(gm.beforeYouDialIn || gm.briefing.length > 0) && (
                  <div style={{ ...card, marginBottom: 18, background: NW.teal50, border: `1px solid ${NW.teal100}` }}>
                    <div style={{ ...LABEL, color: NW.teal700 }}>Before you dial in</div>
                    {gm.beforeYouDialIn ? (
                      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: NW.gray800 }}>
                        {gm.beforeYouDialIn}
                      </p>
                    ) : (
                      gm.briefing.map((b, i) => (
                        <p key={i} style={{ margin: '0 0 6px', fontSize: 14.5, color: NW.gray800 }}>• {b}</p>
                      ))
                    )}
                  </div>
                )}

                {/* ── Asked of everyone for this role ─────────────────────── */}
                {result.roleBrief && result.roleBrief.coreQuestions.length > 0 && (
                  <div style={{ marginBottom: 22 }}>
                    <div style={LABEL}>Ask every candidate for this role</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {result.roleBrief.coreQuestions.map((q, i) => (
                        <div
                          key={i}
                          style={{
                            ...card,
                            borderLeft: `3px solid ${q.dealBreaker ? NW.rose500 : NW.teal500}`,
                          }}
                        >
                          {q.dealBreaker && (
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: NW.rose600, marginBottom: 6 }}>
                              DEAL-BREAKER
                            </div>
                          )}
                          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4, fontWeight: 500, color: NW.black }}>
                            {q.question}
                          </p>
                          <p style={{ margin: '8px 0 0', paddingLeft: 12, borderLeft: `2px solid ${NW.gray200}`, fontSize: 14, color: NW.gray600 }}>
                            <strong style={{ color: NW.gray500 }}>Then: </strong>{q.followUp}
                          </p>
                          <p style={{ margin: '10px 0 0', fontSize: 12.5, color: NW.gray500, lineHeight: 1.5 }}>
                            {q.why}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Specific to this CV ─────────────────────────────────── */}
                <div style={{ marginBottom: 22 }}>
                  <div style={LABEL}>Gaps in this CV ({gm.entries.length})</div>
                  {gm.entries.length === 0 ? (
                    <p style={{ ...card, margin: 0, fontSize: 14, color: NW.gray600 }}>
                      Nothing stands out against this job description.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {gm.entries.map((e) => (
                        <div key={e.id} style={card}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
                            <strong style={{ fontSize: 13.5, color: NW.black }}>{e.requirement}</strong>
                            <span style={{ fontSize: 11, color: NW.gray500 }}>
                              {e.weight === 'must_have' ? 'Must have' : 'Nice to have'}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: NW.gray600, marginBottom: 4 }}>
                            <strong style={{ color: NW.gray500 }}>Role asks: </strong>{e.roleAsks}
                          </div>
                          <div style={{ fontSize: 13, color: NW.gray600, marginBottom: 10 }}>
                            <strong style={{ color: NW.gray500 }}>CV says: </strong>{e.cvSays}
                          </div>
                          <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.4, fontWeight: 500, color: NW.black }}>
                            {e.probeQuestions[0]}
                          </p>
                          {e.probeQuestions[1] && (
                            <p style={{ margin: '8px 0 0', paddingLeft: 12, borderLeft: `2px solid ${NW.gray200}`, fontSize: 13.5, color: NW.gray600 }}>
                              <strong style={{ color: NW.gray500 }}>Then: </strong>{e.probeQuestions[1]}
                            </p>
                          )}
                          {e.why && (
                            <p style={{ margin: '10px 0 0', fontSize: 12.5, color: NW.gray500, lineHeight: 1.5 }}>{e.why}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Where people oversell ───────────────────────────────── */}
                {result.roleBrief && result.roleBrief.commonOverclaims.length > 0 && (
                  <div style={{ marginBottom: 22 }}>
                    <div style={LABEL}>Where candidates usually oversell on this role</div>
                    <div style={card}>
                      {result.roleBrief.commonOverclaims.map((c, i) => (
                        <p key={i} style={{ margin: i ? '8px 0 0' : 0, fontSize: 13.5, color: NW.gray700, lineHeight: 1.5 }}>
                          — {c}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── What RAIA could not judge ───────────────────────────── */}
                {gm.notAssessed.length > 0 && (
                  <div style={{ borderTop: `1px solid ${NW.gray100}`, paddingTop: 16 }}>
                    <div style={LABEL}>Not assessed</div>
                    {gm.notAssessed.map((n, i) => (
                      <p key={i} style={{ margin: '0 0 5px', fontSize: 12.5, color: NW.gray500 }}>{n}</p>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
}
