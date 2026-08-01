'use client';

// ── CV parser test bench ─────────────────────────────────────────────────────
// Staff drop a CV and see exactly what the AI extracts, what it cost, and what
// it flagged for review. Also runs the old rules parser on the same file so the
// two can be compared side by side before we switch the upload flow over.
// Nothing here writes to Firestore.

import { useState, useRef } from 'react';
import { auth } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/nw/shell-ui';
import { Button, NW } from '@/components/nw/primitives';
import { UploadCloud, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';

interface WorkEntry {
  company: string; title: string; startDate: string; endDate: string;
  isCurrent: boolean; location: string; industry: string;
  responsibilities: string[]; accomplishments: string[];
}
interface Profile {
  fullName: string; email: string; phone: string; city: string; countryCode: string;
  linkedin: string; portfolio: string; github: string;
  headline: string; summary: string;
  function: string; subFunction: string; seniority: string;
  yearsExperience: number | null; yearsInFunction: number | null; currentEmployer: string;
  skills: string[]; tools: string[]; industries: string[];
  workHistory: WorkEntry[];
  education: { institution: string; degree: string; field: string; endYear: number | null }[];
  certifications: { name: string; issuer: string; year: number | null }[];
  languages: { language: string; claimedLevel: string }[];
  englishClaimed: string; salaryExpectation: string; availability: string;
  lowConfidence: string[];
}
interface Meta { model: string; costUsd: number; usage: { input_tokens: number; output_tokens: number }; }

const BUILD = 'v4-error-panel';

const card: React.CSSProperties = {
  background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 16, padding: 20,
};
const label: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em',
  textTransform: 'uppercase', marginBottom: 8,
};

function Chips({ items, tone = 'gray' }: { items: string[]; tone?: 'gray' | 'teal' }) {
  if (!items?.length) return <span style={{ fontSize: 12.5, color: NW.gray400 }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {items.map((s) => (
        <span key={s} style={{
          fontSize: 11.5, fontWeight: 500,
          color: tone === 'teal' ? NW.teal700 : NW.gray700,
          background: tone === 'teal' ? NW.teal50 : NW.gray50,
          border: `1px solid ${tone === 'teal' ? '#16A08522' : NW.gray100}`,
          padding: '4px 10px', borderRadius: 999,
        }}>{s}</span>
      ))}
    </div>
  );
}

// Sections render only when they have content — an empty "Accomplishments" block
// looks worse than no block at all.
function Section({ title, children, when = true }: { title: string; children: React.ReactNode; when?: boolean }) {
  if (!when) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <div style={label}>{title}</div>
      {children}
    </div>
  );
}

export default function CVParserPage() {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [engine, setEngine] = useState('');
  const [error, setError] = useState<string>('');
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(file: File) {
    setBusy(true); setProfile(null); setMeta(null); setError(''); setEngine('');
    setFileName(file.name);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) { setError('Not signed in — reload the page and sign in again.'); return; }
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/cv-parse', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      });

      const raw = await res.text();
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(raw); } catch { /* server returned non-JSON (a crash page) */ }

      if (!res.ok) {
        setError(`${res.status} — ${(json.error as string) || raw.slice(0, 400) || 'no response body'}`);
        return;
      }
      if (json.engine === 'code') {
        // The AI path threw and we fell back. Still show it, but say so loudly.
        setEngine('code');
        setError('The AI extractor failed, so this was parsed by the old rules parser. Check the server logs.');
        return;
      }
      setEngine(String(json.engine));
      setProfile(json.profile as Profile);
      setMeta(json.meta as Meta);
      showToast('Parsed', 'success');
    } catch (e) {
      setError(`Request failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const p = profile;

  return (
    <MainLayout>
      <PageHeader
        title="CV parser"
        subtitle="Drop a CV to see exactly what gets extracted, what it cost, and what needs review. Nothing is saved."
      />

      {/* Build stamp — lets us tell instantly whether the browser is running a
          stale cached bundle rather than the deployed one. */}
      <div style={{ fontSize: 11, color: NW.gray400, marginBottom: 10 }}>
        build <strong style={{ color: NW.gray600 }}>{BUILD}</strong> · if this isn&rsquo;t the latest, hard-refresh with Cmd+Shift+R
      </div>

      <div style={{ ...card, textAlign: 'center', padding: 32 }}>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }}
        />
        <UploadCloud size={30} color={NW.gray400} style={{ margin: '0 auto 10px' }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: NW.black }}>Upload a CV</div>
        <div style={{ fontSize: 12.5, color: NW.gray500, margin: '4px 0 14px' }}>
          PDF or Word (.docx) · max 10 MB · scanned PDFs work too
        </div>
        <Button variant="primary" size="md" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Reading…' : 'Choose file'}
        </Button>
        {busy && <div style={{ marginTop: 14 }}><Spinner /></div>}
        {fileName && !busy && (
          <div style={{ marginTop: 12, fontSize: 12, color: NW.gray500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FileText size={13} /> {fileName}{engine && ` · ${engine} engine`}
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...card, marginTop: 16, background: '#FEF2F2', borderColor: '#FCA5A5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#B91C1C' }}>
            <AlertTriangle size={15} /> Parse failed
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5, color: NW.gray800, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {error}
          </div>
        </div>
      )}

      {p && (
        <div style={{ ...card, marginTop: 16 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: NW.black }}>{p.fullName || '—'}</div>
              <div style={{ fontSize: 13.5, color: NW.gray700, marginTop: 3 }}>{p.headline}</div>
              <div style={{ fontSize: 12.5, color: NW.gray500, marginTop: 5 }}>
                {[p.city, p.countryCode].filter(Boolean).join(', ')}
                {p.yearsExperience != null && ` · ${p.yearsExperience} yrs experience`}
              </div>
            </div>
            {meta && (
              <div style={{ textAlign: 'right', fontSize: 11.5, color: NW.gray500 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: NW.teal700 }}>
                  ${meta.costUsd.toFixed(4)}
                </div>
                <div>{meta.usage.input_tokens.toLocaleString()} in / {meta.usage.output_tokens.toLocaleString()} out</div>
                <div style={{ marginTop: 2 }}>140 CVs ≈ ${(meta.costUsd * 140).toFixed(2)}</div>
              </div>
            )}
          </div>

          {/* Classification — what matching runs on */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {[
              ['Function', p.function], ['Sub-function', p.subFunction],
              ['Seniority', p.seniority], ['English (claimed)', p.englishClaimed],
            ].filter(([, v]) => v).map(([k, v]) => (
              <span key={k} style={{
                fontSize: 11.5, color: NW.gray700, background: NW.gray50,
                border: `1px solid ${NW.gray100}`, padding: '5px 11px', borderRadius: 999,
              }}>
                <span style={{ color: NW.gray400 }}>{k}: </span><strong>{v}</strong>
              </span>
            ))}
          </div>

          {p.lowConfidence?.length > 0 && (
            <div style={{
              marginTop: 14, padding: 12, borderRadius: 10,
              background: '#FFF8EC', border: '1px solid #F39C1233',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: '#A16207' }}>
                <AlertTriangle size={14} /> Needs review
              </div>
              <ul style={{ margin: '6px 0 0 20px', fontSize: 12, color: NW.gray700 }}>
                {p.lowConfidence.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          <Section title="Summary" when={!!p.summary}>
            <p style={{ fontSize: 13.5, color: NW.gray800, lineHeight: 1.6, margin: 0 }}>{p.summary}</p>
          </Section>

          <Section title="Skills" when={!!p.skills?.length}><Chips items={p.skills} /></Section>
          <Section title="Tools & applications" when={!!p.tools?.length}><Chips items={p.tools} tone="teal" /></Section>
          <Section title="Industries" when={!!p.industries?.length}><Chips items={p.industries} /></Section>

          <Section title="Work history" when={!!p.workHistory?.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {p.workHistory.map((w, i) => (
                <div key={i} style={{ borderLeft: `2px solid ${NW.gray100}`, paddingLeft: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{w.title}</div>
                  <div style={{ fontSize: 12.5, color: NW.gray600 }}>
                    {w.company}
                    {(w.startDate || w.endDate) && ` · ${w.startDate}${w.endDate ? ` – ${w.endDate}` : w.isCurrent ? ' – Present' : ''}`}
                    {w.location && ` · ${w.location}`}
                  </div>
                  {w.responsibilities?.length > 0 && (
                    <ul style={{ margin: '6px 0 0 18px', fontSize: 12.5, color: NW.gray700, lineHeight: 1.55 }}>
                      {w.responsibilities.map((r, j) => <li key={j}>{r}</li>)}
                    </ul>
                  )}
                  {w.accomplishments?.length > 0 && (
                    <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {w.accomplishments.map((a, j) => (
                        <div key={j} style={{ display: 'flex', gap: 7, fontSize: 12.5, color: NW.teal700 }}>
                          <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          <span>{a}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Education" when={!!p.education?.length}>
            {p.education.map((e, i) => (
              <div key={i} style={{ fontSize: 12.5, color: NW.gray700, marginBottom: 3 }}>
                <strong>{e.degree}</strong>{e.field && ` — ${e.field}`} · {e.institution}{e.endYear ? ` · ${e.endYear}` : ''}
              </div>
            ))}
          </Section>

          <Section title="Certifications" when={!!p.certifications?.length}>
            {p.certifications.map((c, i) => (
              <div key={i} style={{ fontSize: 12.5, color: NW.gray700, marginBottom: 3 }}>
                <strong>{c.name}</strong>{c.issuer && ` · ${c.issuer}`}{c.year ? ` · ${c.year}` : ''}
              </div>
            ))}
          </Section>

          <Section title="Languages" when={!!p.languages?.length}>
            <Chips items={p.languages.map((l) => `${l.language} — ${l.claimedLevel}`)} />
          </Section>

          <Section title="Contact & links" when={!!(p.email || p.phone || p.linkedin || p.portfolio || p.github)}>
            <div style={{ fontSize: 12.5, color: NW.gray700, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {p.email && <div>{p.email}</div>}
              {p.phone && <div>{p.phone}</div>}
              {p.linkedin && <div><a href={p.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: NW.teal700 }}>{p.linkedin}</a></div>}
              {p.portfolio && <div><a href={p.portfolio} target="_blank" rel="noopener noreferrer" style={{ color: NW.teal700 }}>{p.portfolio}</a></div>}
              {p.github && <div><a href={p.github} target="_blank" rel="noopener noreferrer" style={{ color: NW.teal700 }}>{p.github}</a></div>}
            </div>
          </Section>
        </div>
      )}
    </MainLayout>
  );
}
