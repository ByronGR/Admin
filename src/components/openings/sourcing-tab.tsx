'use client';

// ============================================================
// Sourcing (X-ray) tab — per-opening LinkedIn sourcing.
// Source panel pulls candidates via /api/sourcing/find; the table tracks them
// through a status pipeline. Ported from the standalone X-ray tool + design handoff.
// Candidates + plan live in Firestore (sourcedCandidates / searchPlans).
// ============================================================

import { useState, useEffect, useMemo, useRef, useCallback, Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  db, auth, collection, query, where, onSnapshot, doc, updateDoc, addDoc, getDoc, serverTimestamp,
} from '@/lib/firebase';
import { NW, Icon, Button } from '@/components/nw/primitives';
import { Modal } from '@/components/ui/modal';
import {
  SRC_STATUSES, SRC_REASONS, SRC_COUNTRIES,
  type Opening, type SourcedCandidate, type SourceStatus, type SearchPlan, type SearchRun,
} from '@/lib/types';

// Staff who can own a sourced candidate.
const SRC_OWNERS = [
  { id: 'bg', name: 'Byron Giraldo', initials: 'BG', color: '#16A085' },
  { id: 'sp', name: 'Stephany Picos', initials: 'SP', color: '#8E44AD' },
  { id: 'dc', name: 'Daniela Calceron', initials: 'DC', color: '#2980B9' },
];
const ownerById = (id?: string) => SRC_OWNERS.find(o => o.id === id);

// Sort order for the Status column — Reached out first, dead statuses last.
const STATUS_ORDER: Record<SourceStatus, number> = { 'Reached out': 0, Interested: 1, New: 2, Applied: 3, 'Not interested': 4 };

const STATUS_STYLE: Record<SourceStatus, { fg: string; bg: string; dot: string }> = {
  New: { fg: '#475569', bg: '#EEF1F5', dot: '#94A3B8' },
  'Reached out': { fg: '#B45309', bg: '#FEF3C7', dot: '#D97706' },
  Interested: { fg: '#15803D', bg: '#DCFCE7', dot: '#16A34A' },
  'Not interested': { fg: '#B91C1C', bg: '#FEE2E2', dot: '#DC2626' },
  Applied: { fg: '#4F46E5', bg: '#EEF2FF', dot: '#4F46E5' },
};

const fmtUSD = (raw: string) => {
  const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  return n ? '$' + n.toLocaleString('en-US') : '';
};
// Role / industry / seniority words that show up in LinkedIn slugs but aren't names.
const NAME_STOP = new Set((
  'marketing sales digital growth manager director copywriter copy designer design developer dev ' +
  'engineer engineering seo sem ppc crm account accounts executive specialist consultant consulting ' +
  'freelance freelancer remote lifecycle email brand branding content social media ux ui product data ' +
  'analyst analytics recruiter recruiting coach mentor strategist strategy ceo cmo cto coo founder ' +
  'cofounder owner mba phd msc pmp agency ads advertising ecommerce saas b2b b2c senior sr junior jr ' +
  'lead head vp officer partner gestor gestora inbound outbound abm kam dem gen demandgen demand ' +
  'digitalmarketing growthmarketing marketingdigital marketingydiseño publicista'
).split(' '));

// Extract a clean display name from a LinkedIn slug: drop trailing hash ids, any
// number-bearing fragments, and role/keyword tokens — keep just the name words.
const nameFromSlug = (li: string) => {
  let slug = li.replace(/^.*\/in\//, '').replace(/[/?#].*$/, '');
  try { slug = decodeURIComponent(slug); } catch { /* noop */ }
  const toks = slug.split('-')
    .map(t => t.toLowerCase().trim().replace(/\d+$/, ''))   // drop trailing digits (e.g. nickwest89 → nickwest)
    .filter(t => t && t.length > 1 && !/\d/.test(t) && !NAME_STOP.has(t)); // drop hashes + keywords
  const name = toks.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return name || slug.replace(/[0-9]/g, ' ').split(/[-\s]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};
// Normalize any LinkedIn value (full URL or bare slug) to a comparable slug.
const slugify = (s: string) => (s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^(www\.)?linkedin\.com\/in\//, '').replace(/[/?#].*$/, '').replace(/\/+$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const normName = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const field: CSSProperties = { height: 36, boxSizing: 'border-box', border: `1px solid ${NW.gray200}`, borderRadius: 9, padding: '0 10px', font: 'inherit', fontSize: 12.5, color: NW.black, outline: 'none', background: NW.white };
const lbl: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: NW.gray500, marginBottom: 6, display: 'block' };

function OwnerAvatar({ id, showName }: { id?: string; showName?: boolean }) {
  const o = ownerById(id);
  if (!o) return <span style={{ fontSize: 12.5, color: NW.gray400 }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ width: 22, height: 22, borderRadius: '50%', background: o.color, color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{o.initials}</span>
      {showName && <span style={{ fontSize: 12.5, color: NW.gray700 }}>{o.name.split(' ')[0]}</span>}
    </span>
  );
}

// Status pill that is a native select — one click to change.
function StatusSelect({ value, onChange }: { value: SourceStatus; onChange: (s: SourceStatus) => void }) {
  const s = STATUS_STYLE[value];
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span style={{ position: 'absolute', left: 10, width: 6, height: 6, borderRadius: '50%', background: s.dot, pointerEvents: 'none' }} />
      <select value={value} onChange={e => onChange(e.target.value as SourceStatus)}
        style={{ appearance: 'none', WebkitAppearance: 'none', font: 'inherit', fontSize: 11.5, fontWeight: 600, color: s.fg, background: s.bg, border: `1px solid ${s.fg}22`, borderRadius: 999, padding: '4px 22px 4px 22px', cursor: 'pointer' }}>
        {SRC_STATUSES.map(x => <option key={x} value={x} style={{ color: NW.black, background: '#fff' }}>{x}</option>)}
      </select>
      <Icon name="chevron-down" size={12} color={s.fg} style={{ position: 'absolute', right: 7, pointerEvents: 'none' }} />
    </span>
  );
}

function ReasonSelect({ value, onChange }: { value?: string; onChange: (r: string) => void }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}
      style={{ font: 'inherit', fontSize: 11, fontWeight: 600, color: '#B91C1C', background: '#FEE2E2', border: '1px solid #B91C1C22', borderRadius: 999, padding: '4px 8px', cursor: 'pointer', maxWidth: 150 }}>
      <option value="" style={{ color: NW.black }}>Reason…</option>
      {SRC_REASONS.map(r => <option key={r} value={r} style={{ color: NW.black }}>{r}</option>)}
    </select>
  );
}

function SalaryCell({ value, onSave }: { value?: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);
  if (editing) {
    return <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={() => { setEditing(false); const f = fmtUSD(v); if (f !== (value || '')) onSave(f); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="2000" style={{ ...field, height: 28, width: 90, fontSize: 12 }} />;
  }
  return value
    ? <button onClick={() => setEditing(true)} style={{ font: 'inherit', fontSize: 12.5, color: NW.black, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>{value}</button>
    : <button onClick={() => setEditing(true)} style={{ font: 'inherit', fontSize: 12, color: NW.teal600, background: 'transparent', border: `1px dashed ${NW.gray200}`, borderRadius: 7, cursor: 'pointer', padding: '3px 8px' }}>+ Add</button>;
}

// ── Source panel — the only block that PULLS people in ──
// Keyword steering as tokens rather than a comma-separated string: a committed
// keyword is a thing you can see and remove, and a half-typed one is visibly not
// yet part of the search.
function TokenField({ tokens, onChange, tone, placeholder, help }: {
  tokens: string[]; onChange: (t: string[]) => void;
  tone: 'include' | 'exclude'; placeholder: string; help: string;
}) {
  const [draft, setDraft] = useState('');
  const st = tone === 'include'
    ? { bg: NW.teal50, fg: NW.teal700 }
    : { bg: '#FEE2E2', fg: '#B91C1C' };

  const commit = () => {
    const v = draft.trim().replace(/,+$/, '');
    if (v && !tokens.some(t => t.toLowerCase() === v.toLowerCase())) onChange([...tokens, v]);
    setDraft('');
  };

  return (
    <div>
      <div
        style={{ border: `1px solid ${NW.gray200}`, borderRadius: 10, padding: '7px 9px', minHeight: 42, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', background: NW.white, cursor: 'text' }}
        onClick={e => { (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus(); }}
      >
        {tokens.map(t => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: st.bg, color: st.fg, borderRadius: 7, padding: '3px 7px', fontSize: 12, fontWeight: 500 }}>
            {t}
            <button
              onClick={e => { e.stopPropagation(); onChange(tokens.filter(x => x !== t)); }}
              aria-label={`Remove ${t}`}
              style={{ font: 'inherit', lineHeight: 1, color: 'inherit', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', opacity: 0.55 }}
            >×</button>
          </span>
        ))}
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          // Comma commits too, so pasting a comma-separated list still works.
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
            else if (e.key === 'Backspace' && !draft && tokens.length) onChange(tokens.slice(0, -1));
          }}
          onBlur={commit}
          placeholder={tokens.length ? '' : placeholder}
          style={{ flex: 1, minWidth: 90, border: 'none', outline: 'none', font: 'inherit', fontSize: 12.5, color: NW.black, background: 'transparent', padding: '2px 0' }}
        />
      </div>
      <div style={{ fontSize: 11.5, color: NW.gray400, marginTop: 5 }}>{help}</div>
    </div>
  );
}

// The only block on the page that PULLS people in — deliberately the most
// prominent thing here, and visually distinct from the filter toolbar below.
// A white card with a gradient header, not a tinted panel: the tint made the
// whole tab read as one washed-out surface with no clear action.
function SourcePanel({ plan, countries, setCountries, onRun, busy, include, setInclude, exclude, setExclude, onViewPlan }: {
  plan: SearchPlan | null; countries: string[]; setCountries: (c: string[]) => void;
  onRun: (mode: 'ai' | 'more') => void; busy: false | 'ai' | 'more';
  include: string[]; setInclude: (v: string[]) => void;
  exclude: string[]; setExclude: (v: string[]) => void;
  onViewPlan: () => void;
}) {
  const hasPlan = !!(plan && plan.phrases && plan.phrases.length);
  const nOn = countries.length;
  const allOn = nOn === SRC_COUNTRIES.length;
  const toggle = (code: string) =>
    setCountries(countries.includes(code) ? countries.filter(c => c !== code) : [...countries, code]);

  const headerBtn: CSSProperties = {
    font: 'inherit', fontSize: 13.5, fontWeight: 600, height: 38, padding: '0 16px',
    borderRadius: 999, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
      {/* Header — the action, stated plainly */}
      <div style={{ background: 'linear-gradient(100deg, #0E6B58, #16A085 62%, #1ABC9C)', color: NW.white, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {hasPlan ? `Pull a fresh batch from ${nOn} countr${nOn === 1 ? 'y' : 'ies'}` : 'Set up sourcing for this opening'}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 3 }}>
            {hasPlan ? 'Runs append candidates — nothing is ever removed.' : 'AI Search reads the job post and writes the search plan (once).'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Before a plan exists the hierarchy flips: AI Search is the only way in. */}
          <button
            onClick={() => onRun('ai')}
            disabled={!!busy || !nOn}
            style={{
              ...headerBtn,
              background: hasPlan ? 'rgba(255,255,255,.14)' : NW.white,
              color: hasPlan ? NW.white : NW.teal700,
              border: `1px solid ${hasPlan ? 'rgba(255,255,255,.4)' : 'transparent'}`,
              opacity: (!!busy || !nOn) ? 0.55 : 1,
              cursor: (!!busy || !nOn) ? 'default' : 'pointer',
            }}
          >
            <Icon name="sparkles" size={15} color={hasPlan ? NW.white : NW.teal700} />
            {busy === 'ai' ? 'AI thinking…' : hasPlan ? 'AI Search' : 'Run AI Search'}
          </button>
          {hasPlan && (
            <button
              onClick={() => onRun('more')}
              disabled={!!busy || !nOn}
              style={{
                ...headerBtn, background: NW.white, color: NW.teal700, border: '1px solid transparent',
                opacity: (!!busy || !nOn) ? 0.55 : 1, cursor: (!!busy || !nOn) ? 'default' : 'pointer',
              }}
            >
              <Icon name="plus" size={15} color={NW.teal700} />
              {busy === 'more' ? 'Searching…' : 'Find more candidates'}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 20px 18px', display: 'grid', gap: 16 }}>
        {hasPlan && (
          <div style={{ fontSize: 11.5, color: NW.gray500 }}>
            AI Search rewrites the plan — only needed if the role changes. Find more reuses it at no AI cost.
          </div>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
            <span style={lbl}>
              Countries to search <span style={{ color: NW.teal600 }}>{nOn} / {SRC_COUNTRIES.length}</span>
            </span>
            <button
              onClick={() => setCountries(allOn ? [] : SRC_COUNTRIES.map(c => c.code))}
              style={{ font: 'inherit', fontSize: 11.5, fontWeight: 600, color: NW.teal600, background: 'transparent', border: 'none', cursor: 'pointer' }}
            >{allOn ? 'Clear all' : 'Select all'}</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SRC_COUNTRIES.map(c => {
              const on = countries.includes(c.code);
              return (
                <button key={c.code} onClick={() => toggle(c.code)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, font: 'inherit', fontSize: 12.5,
                  fontWeight: on ? 600 : 500, cursor: 'pointer', borderRadius: 999, padding: '6px 12px',
                  border: `1px solid ${on ? NW.teal500 : NW.gray200}`,
                  background: on ? NW.teal50 : NW.white,
                  color: on ? NW.teal700 : NW.gray600,
                }}>
                  {on && <Icon name="check" size={11} color={NW.teal500} />}{c.name}
                </button>
              );
            })}
          </div>
          {!nOn && <div style={{ fontSize: 12, color: '#B45309', marginTop: 8 }}>Pick at least one country.</div>}
        </div>

        {/* Manual steering, on top of the AI plan */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          <div>
            <label style={lbl}>Must include</label>
            <TokenField
              tokens={include} onChange={setInclude} tone="include"
              placeholder="Add a keyword…"
              help="Searched as well as the AI plan — widens the net."
            />
          </div>
          <div>
            <label style={lbl}>Exclude</label>
            <TokenField
              tokens={exclude} onChange={setExclude} tone="exclude"
              placeholder="Add a keyword…"
              help="Kept out of the query and filtered from results."
            />
          </div>
        </div>
      </div>

      {/* Footer — what the saved plan is */}
      {hasPlan && plan && (
        <div style={{ background: NW.gray50, borderTop: `1px solid ${NW.gray100}`, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: NW.teal700, background: NW.teal50, border: `1px solid ${NW.teal500}33`, borderRadius: 999, padding: '2px 8px' }}>
            {plan.runs || 0} run{plan.runs === 1 ? '' : 's'}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: NW.gray500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Search plan</span>
          <span style={{ flex: 1, minWidth: 120, fontSize: 11.5, color: NW.gray500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {(plan.phrases || []).join(' · ')}
          </span>
          {typeof plan.kept === 'number' && (
            <span style={{ fontSize: 11.5, color: NW.gray500, whiteSpace: 'nowrap' }}>{plan.kept} kept</span>
          )}
          <button onClick={onViewPlan} style={{ font: 'inherit', fontSize: 11.5, fontWeight: 600, color: NW.teal700, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            View plan
          </button>
        </div>
      )}
    </div>
  );
}

function AddManualModal({ openingId, onClose, onDone }: { openingId: string; onClose: () => void; onDone: () => void }) {
  const [li, setLi] = useState(''); const [name, setName] = useState(''); const [autoName, setAutoName] = useState(true);
  const [owner, setOwner] = useState(''); const [country, setCountry] = useState('co'); const [err, setErr] = useState(''); const [saving, setSaving] = useState(false);
  function onLi(v: string) { setLi(v); if (autoName && v.includes('/in/')) setName(nameFromSlug(v)); }
  async function save() {
    if (!li.includes('/in/')) { setErr('Paste a LinkedIn profile URL (must contain /in/).'); return; }
    setSaving(true);
    const slug = li.replace(/^.*\/in\//, '').replace(/[/?#].*$/, '');
    try {
      await addDoc(collection(db, 'sourcedCandidates'), {
        openingId, name: name.trim() || nameFromSlug(li), li: '/in/' + slug, linkedin: 'https://www.linkedin.com/in/' + slug,
        location: SRC_COUNTRIES.find(c => c.code === country)?.name || '', country: SRC_COUNTRIES.find(c => c.code === country)?.name || '',
        source: 'Manual', owner, status: 'New', reason: '', salary: '', applied: false, last: 'just now', notes: '',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      onDone();
    } catch (e) { console.error('[sourcing] add failed', e); setErr('Could not save — check permissions.'); setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Add candidate manually" className="min-w-0">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 14 }}>
        <div><label style={lbl}>LinkedIn URL</label><input style={{ ...field, height: 38, width: '100%' }} value={li} placeholder="https://www.linkedin.com/in/…" onChange={e => onLi(e.target.value)} />{err && <div style={{ fontSize: 11.5, color: '#B91C1C', marginTop: 5 }}>{err}</div>}</div>
        <div><label style={lbl}>Name</label><input style={{ ...field, height: 38, width: '100%' }} value={name} placeholder="Full name" onChange={e => { setName(e.target.value); setAutoName(false); }} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
          <div><label style={lbl}>Owner</label><select style={{ ...field, height: 38, width: '100%' }} value={owner} onChange={e => setOwner(e.target.value)}><option value="">Unassigned</option>{SRC_OWNERS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div><label style={lbl}>Country</label><select style={{ ...field, height: 38, width: '100%' }} value={country} onChange={e => setCountry(e.target.value)}>{SRC_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${NW.gray100}` }}>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Add candidate'}</Button>
      </div>
    </Modal>
  );
}

// What one search run was going after. The point is being able to tell whether a
// candidate arrived before or after a change — so the countries, aliases and
// keyword steering are shown as they were AT THAT RUN, not as they are now.
function SearchRefModal({ run, onClose, onFilter }: { run: SearchRun; onClose: () => void; onFilter: () => void }) {
  const when = (() => {
    const d = new Date(run.at);
    return isNaN(d.getTime()) ? run.at : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  })();
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 12, padding: '8px 0', borderTop: `1px solid ${NW.gray100}` }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: NW.gray500 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: NW.gray800, minWidth: 0 }}>{children}</div>
    </div>
  );
  const chips = (items: string[] | undefined, tone: 'plain' | 'good' | 'bad') => {
    if (!items?.length) return <span style={{ color: NW.gray400 }}>—</span>;
    const st = tone === 'good' ? { background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0' }
      : tone === 'bad' ? { background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }
      : { background: NW.gray50, color: NW.gray700, border: `1px solid ${NW.gray200}` };
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {items.map(x => <span key={x} style={{ ...st, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '2px 8px' }}>{x}</span>)}
      </div>
    );
  };
  return (
    <Modal open onClose={onClose} title={`Search ${run.ref}`} className="min-w-0">
      <p style={{ fontSize: 13, color: NW.gray600, lineHeight: 1.6, margin: '0 0 12px' }}>
        What this search was going after. Anyone tagged <b>{run.ref}</b> came from this run.
      </p>
      <div>
        <Row label="When">{when}{run.by ? <span style={{ color: NW.gray400 }}> · {run.by}</span> : null}</Row>
        <Row label="Type">{run.mode === 'ai' ? 'AI Search — the plan was rewritten' : 'Find more — reused the saved plan'}</Row>
        <Row label="Countries">{chips(run.countries, 'plain')}</Row>
        <Row label="Read as">{run.aliases?.length ? chips(run.aliases, 'plain') : <span style={{ color: NW.gray400 }}>—</span>}</Row>
        <Row label="Discipline">{run.domain || <span style={{ color: NW.gray400 }}>—</span>}</Row>
        <Row label="Must include">{chips(run.include, 'good')}</Row>
        <Row label="Excluded">{chips(run.exclude, 'bad')}</Row>
        <Row label="Result">
          {run.found} net-new
          {run.resurfaced ? <span style={{ color: NW.gray500 }}> · {run.resurfaced} already on the board</span> : null}
        </Row>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        <Button size="sm" onClick={onFilter}>Show only {run.ref}</Button>
      </div>
    </Modal>
  );
}

function PlanModal({ plan, onClose, onRerun, busy }: { plan: SearchPlan | null; onClose: () => void; onRerun: () => void; busy: boolean }) {
  return (
    <Modal open onClose={onClose} title="Search plan" className="min-w-0">
      <p style={{ fontSize: 13, color: NW.gray600, lineHeight: 1.6, margin: '0 0 14px' }}>These phrases were written once by AI from the job post and are reused on every “Find more” at no AI cost. Candidates are geo-locked to the selected countries, deduped against the master list, and founders/owners/CEOs are excluded.</p>
      {plan?.aliases?.length ? <div style={{ fontSize: 12.5, color: NW.gray600, margin: '0 0 12px' }}>Read as <b>{plan.aliases.join(' · ')}</b>{plan.domain ? ` — domain: ${plan.domain} (every phrase anchored to it)` : ''}</div> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {(plan?.phrases || []).map((p, i) => <span key={i} style={{ fontSize: 12, color: NW.teal700, background: NW.teal50, border: `1px solid ${NW.teal500}30`, borderRadius: 999, padding: '5px 11px' }}>{p}</span>)}
        {!plan?.phrases?.length && <span style={{ fontSize: 13, color: NW.gray400 }}>No plan yet — run AI Search.</span>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${NW.gray100}` }}>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        <Button size="sm" icon="sparkles" disabled={busy} onClick={onRerun}>{busy ? 'Thinking…' : 'Re-run AI Search'}</Button>
      </div>
    </Modal>
  );
}

function NotesModal({ row, onClose, onSave }: { row: SourcedCandidate; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(row.notes || '');
  const [saving, setSaving] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Notes — ${row.name}`} className="min-w-0">
      <p style={{ fontSize: 11.5, color: NW.gray500, margin: '0 0 8px' }}>Staff-only. Separate from the “not interested” reason.</p>
      <textarea autoFocus value={v} onChange={e => setV(e.target.value)} rows={5} style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${NW.gray200}`, borderRadius: 9, padding: 10, font: 'inherit', fontSize: 13.5, resize: 'vertical' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${NW.gray100}` }}>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={saving} onClick={() => { setSaving(true); onSave(v); }}>{saving ? 'Saving…' : 'Save note'}</Button>
      </div>
    </Modal>
  );
}

// ── Main tab ──
export function SourcingTab({ op }: { op: Opening }) {
  const openingId = op.id;
  const [rows, setRows] = useState<SourcedCandidate[]>([]);
  const [plan, setPlan] = useState<SearchPlan | null>(null);
  const [appliedSlugs, setAppliedSlugs] = useState<Set<string>>(new Set());
  const [appliedNames, setAppliedNames] = useState<Set<string>>(new Set());
  const [loadErr, setLoadErr] = useState(false);
  const [countries, setCountries] = useState<string[]>(SRC_COUNTRIES.filter(c => c.on).map(c => c.code));
  const [busy, setBusy] = useState<false | 'ai' | 'more'>(false);
  const [runNote, setRunNote] = useState('');
  // Manual steering, remembered across runs within the session so "Find more"
  // keeps whatever the recruiter dialled in.
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  // Audit trail. Served by the API — searchRuns has no Firestore rule of its own.
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [fRef, setFRef] = useState('');
  const [refDetail, setRefDetail] = useState<SearchRun | null>(null);
  const [groupByRef, setGroupByRef] = useState(false);

  // Filters
  const [q, setQ] = useState(''); const [fCountry, setFCountry] = useState(''); const [fOwner, setFOwner] = useState('');
  const [fStatus, setFStatus] = useState<SourceStatus | ''>(''); const [fSource, setFSource] = useState('');
  const [pageSize, setPageSize] = useState(25); const [pageNum, setPageNum] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [modal, setModal] = useState<null | 'add' | 'plan'>(null);
  const [notesRow, setNotesRow] = useState<SourcedCandidate | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'sourcedCandidates'), where('openingId', '==', openingId)),
      snap => { setRows(snap.docs.map(d => ({ ...d.data(), id: d.id }) as SourcedCandidate)); setLoadErr(false); },
      err => { console.error('[sourcing] snapshot', err); setLoadErr(true); });
    getDoc(doc(db, 'searchPlans', openingId)).then(s => setPlan(s.exists() ? ({ ...s.data(), openingId } as SearchPlan) : null)).catch(() => {});
    return () => unsub();
  }, [openingId]);

  // Auto-applied: match sourced people to real applicants by LinkedIn slug.
  // Applying appends the candidate to this opening's pipeline, where their profile
  // carries a LinkedIn — so anyone in the pipeline whose slug matches is "Applied".
  useEffect(() => {
    const code = op.code || op.id;
    getDoc(doc(db, 'pipelines', code)).then(s => {
      const set = new Set<string>();
      const names = new Set<string>();
      if (s.exists()) {
        const cands = (s.data().candidates || []) as Record<string, unknown>[];
        cands.forEach(c => {
          const prof = (c.profile || {}) as Record<string, unknown>;
          const raw = (c.linkedIn || c.linkedin || prof.linkedIn || prof.linkedin || '') as string;
          const slug = slugify(raw);
          if (slug) set.add(slug);
          const nm = (c.name || c.candidateName || prof.name || [prof.firstName, prof.lastName].filter(Boolean).join(' ') || '') as string;
          const n = normName(nm);
          if (n) names.add(n);
        });
      }
      setAppliedSlugs(set);
      setAppliedNames(names);
    }).catch(() => {});
  }, [op.code, op.id]);

  const save = (id: string, patch: Partial<SourcedCandidate>) => {
    updateDoc(doc(db, 'sourcedCandidates', id), { ...patch, updatedAt: serverTimestamp() }).catch(e => { console.error('[sourcing] save', e); alert('Could not save — check permissions.'); });
  };
  const setStatus = (r: SourcedCandidate, status: SourceStatus) => {
    const patch: Partial<SourcedCandidate> = { status };
    if (status === 'Reached out') { patch.last = 'just now'; if (!r.owner) patch.owner = SRC_OWNERS[0].id; }
    if (status !== 'Not interested') patch.reason = '';
    save(r.id, patch);
  };

  // The audit trail comes from the API, not a client Firestore read — searchRuns
  // has no rule of its own, and this keeps it that way.
  const loadRuns = useCallback(async () => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/sourcing/find?openingId=${encodeURIComponent(openingId)}`, {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      });
      const d = await res.json();
      if (d.ok) setRuns(d.runs as SearchRun[]);
    } catch { /* the trail is informational — never block the table on it */ }
  }, [openingId]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  // Seed the steering from this opening's most recent run, so re-running picks
  // up where the last one left off instead of silently dropping the keywords.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !runs.length) return;
    seeded.current = true;
    const last = runs[0];   // loadRuns returns newest first
    if (last.include?.length) setInclude(last.include);
    if (last.exclude?.length) setExclude(last.exclude);
  }, [runs]);

  async function runSearch(mode: 'ai' | 'more') {
    if (!countries.length || busy) return;
    setBusy(mode); setRunNote('');
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/sourcing/find', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ openingId, countries, english: true, excludeOwners: true, mode, includeKeywords: include, excludeKeywords: exclude }),
      });
      const d = await res.json();
      if (!d.ok) { setRunNote(d.message || d.reason || 'Search failed.'); }
      else {
        setRunNote(`${d.ref ? d.ref + ' · ' : ''}Added ${d.added} new · scanned ${d.stats?.found ?? 0} · skipped ${d.stats?.skipped_existing ?? 0} already in the sheet${d.stats?.dropped_excluded ? ` · ${d.stats.dropped_excluded} dropped by Exclude` : ''}${d.aiCost ? ' · AI wrote the plan' : ''}`);
        getDoc(doc(db, 'searchPlans', openingId)).then(s => setPlan(s.exists() ? ({ ...s.data(), openingId } as SearchPlan) : null));
        loadRuns();
      }
    } catch (e) { setRunNote('Error: ' + (e as Error).message); }
    setBusy(false);
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}; SRC_STATUSES.forEach(s => c[s] = 0);
    rows.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (q && !(`${r.name} ${r.linkedin}`.toLowerCase().includes(q.toLowerCase()))) return false;
    if (fCountry && r.country !== fCountry) return false;
    if (fOwner && (fOwner === 'none' ? !!r.owner : r.owner !== fOwner)) return false;
    if (fStatus && r.status !== fStatus) return false;
    if (fRef && !(r.refs || []).includes(fRef)) return false;
    if (fSource && r.source !== fSource) return false;
    return true;
    // fRef belongs here: leaving it out meant picking a search recomputed
    // nothing, so the filter silently did nothing at all.
  }), [rows, q, fCountry, fOwner, fStatus, fSource, fRef]);

  const total = rows.length;
  const isFiltered = filtered.length !== total;
  const isApplied = (r: SourcedCandidate) => !!(r.applied || appliedSlugs.has(slugify(r.li.replace(/^\/in\//, ''))) || appliedNames.has(normName(r.name)));
  const sortedFiltered = useMemo(() => {
    if (!sort) return filtered;
    const val = (r: SourcedCandidate): number | string => {
      switch (sort.key) {
        case 'name': return (r.name || '').toLowerCase();
        case 'location': return (r.location || '').toLowerCase();
        case 'source': return r.source || '';
        case 'owner': return (ownerById(r.owner)?.name || 'zzz').toLowerCase();
        case 'status': return STATUS_ORDER[r.status] ?? 99;
        case 'salary': return parseInt(String(r.salary || '').replace(/[^0-9]/g, ''), 10) || 0;
        case 'applied': return isApplied(r) ? 0 : 1;
        case 'last': return r.createdAt?.seconds ?? 0;
        default: return 0;
      }
    };
    return [...filtered].sort((a, b) => { const va = val(a), vb = val(b); return va < vb ? -sort.dir : va > vb ? sort.dir : 0; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, appliedSlugs, appliedNames]);
  useEffect(() => { setPageNum(1); }, [q, fCountry, fOwner, fStatus, fSource, fRef, pageSize, total]);
  const pageCount = Math.max(1, Math.ceil(sortedFiltered.length / pageSize));
  const pageRows = sortedFiltered.slice((pageNum - 1) * pageSize, pageNum * pageSize);
  const toggleSort = (key: string) => setSort(prev => (prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  // Grouped view: which search each candidate CAME FROM. Someone can carry
  // several refs (a later run found them again), so they're filed under the
  // first — that's their origin. The others still show as badges on the row.
  const groups = useMemo(() => {
    if (!groupByRef) return null;
    const bucket = new Map<string, SourcedCandidate[]>();
    for (const r of pageRows) {
      const key = (r.refs || [])[0] || '';   // '' = manual, or sourced before refs existed
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key)!.push(r);
    }
    return [...bucket.entries()]
      .map(([ref, list]) => ({ ref, list, run: runs.find(x => x.ref === ref) || null }))
      // Newest search first; the untracked bucket always sits last.
      .sort((a, b) => {
        if (!a.ref) return 1;
        if (!b.ref) return -1;
        return Number(b.ref.slice(1)) - Number(a.ref.slice(1));
      });
  }, [groupByRef, pageRows, runs]);

  // One candidate row. Shared by the flat and grouped views so the two can never
  // drift apart.
  const renderRow = (r: SourcedCandidate) => (
              <tr key={r.id} style={{ borderTop: `1px solid ${NW.gray100}`, height: 56 }}>
                <td style={{ padding: '8px 14px' }}>
                  <div style={{ maxWidth: 230, fontSize: 13, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name}
                    {/* Which search(es) surfaced them — click to see what that search was going after. */}
                    {(r.refs || []).map(ref => (
                      <button
                        key={ref}
                        onClick={e => { e.stopPropagation(); const run = runs.find(x => x.ref === ref); if (run) setRefDetail(run); }}
                        title={`Surfaced by search ${ref}`}
                        style={{ font: 'inherit', fontSize: 9.5, fontWeight: 700, color: NW.gray500, background: NW.gray50, border: `1px solid ${NW.gray200}`, borderRadius: 5, padding: '1px 4px', marginLeft: 5, cursor: 'pointer', verticalAlign: 'middle' }}
                      >{ref}</button>
                    ))}
                  </div>
                  {/* Their LinkedIn headline. An X-ray only sees a result title
                      and one line of snippet, so without this a row is a name
                      and a country — not enough to judge anyone by. */}
                  {r.headline && (
                    <div style={{ maxWidth: 230, fontSize: 11.5, color: NW.gray500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }} title={r.headline}>
                      {r.headline}
                    </div>
                  )}
                  <a href={r.linkedin} target="_blank" rel="noopener noreferrer" title={r.linkedin} style={{ display: 'block', maxWidth: 230, fontSize: 11.5, color: NW.teal600, textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.li} ↗</a>
                  {r.dupe && <span style={{ fontSize: 10.5, color: '#B45309' }}>⚠ also in another opening</span>}
                </td>
                <td style={{ padding: '8px 14px', color: NW.gray600, whiteSpace: 'nowrap' }}>{r.location || '—'}</td>
                <td style={{ padding: '8px 14px' }}><span style={{ fontSize: 10.5, fontWeight: 600, borderRadius: 6, padding: '2px 8px', color: r.source === 'X-ray' ? NW.teal700 : NW.gray600, background: r.source === 'X-ray' ? NW.teal50 : NW.gray50 }}>{r.source}</span></td>
                <td style={{ padding: '8px 14px' }}>
                  <select value={r.owner || ''} onChange={e => save(r.id, { owner: e.target.value })} style={{ font: 'inherit', fontSize: 12, color: NW.gray700, border: 'none', background: 'transparent', cursor: 'pointer' }}>
                    <option value="">—</option>{SRC_OWNERS.map(o => <option key={o.id} value={o.id}>{o.name.split(' ')[0]}</option>)}
                  </select>
                </td>
                <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    <StatusSelect value={r.status} onChange={s => setStatus(r, s)} />
                    {r.status === 'Not interested' && <ReasonSelect value={r.reason} onChange={reason => save(r.id, { reason })} />}
                  </span>
                </td>
                <td style={{ padding: '8px 14px' }}><SalaryCell value={r.salary} onSave={v => save(r.id, { salary: v })} /></td>
                <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>{isApplied(r) ? <span style={{ color: NW.green600, fontWeight: 600, fontSize: 12 }}>✓ Applied</span> : <span style={{ color: NW.gray400 }}>—</span>}</td>
                <td style={{ padding: '8px 14px', color: NW.gray500, fontSize: 12, whiteSpace: 'nowrap', width: 110 }}>{r.last || '—'}</td>
                {/* Pinned right: notes survive the horizontal scroll. The background
                    must be opaque and match the row, or the scrolled columns show
                    through underneath it. */}
                <td style={{ padding: '8px 14px', borderLeft: `1px solid ${NW.gray100}`, width: 200, position: 'sticky', right: 0, background: NW.white, zIndex: 1 }}>
                  <button onClick={() => setNotesRow(r)} style={{ font: 'inherit', fontSize: 12, color: r.notes ? NW.gray700 : NW.teal600, background: 'transparent', border: r.notes ? 'none' : `1px dashed ${NW.gray200}`, borderRadius: 7, cursor: 'pointer', padding: r.notes ? 0 : '3px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.notes || 'Add note'}</button>
                </td>
              </tr>
  );

  return (
    <div style={{ marginTop: 4 }}>
      <SourcePanel plan={plan} countries={countries} setCountries={setCountries} onRun={runSearch} busy={busy} include={include} setInclude={setInclude} exclude={exclude} setExclude={setExclude} onViewPlan={() => setModal('plan')} />
      {runNote && <div style={{ fontSize: 12.5, color: NW.gray600, background: NW.gray50, border: `1px solid ${NW.gray100}`, borderRadius: 9, padding: '9px 12px', marginBottom: 14 }}>{runNote}</div>}
      {loadErr && <div style={{ fontSize: 12.5, color: '#B45309', background: NW.yellow50, border: '1px solid #EAB30840', borderRadius: 9, padding: '9px 12px', marginBottom: 14 }}>Can’t load sourced candidates — the Firestore rules for <b>sourcedCandidates</b> / <b>searchPlans</b> may still need to be published.</div>}

      {/* Status funnel — the shape of the pipeline, and the status filter.
          Each card carries a track filled to its share of the total, so a
          board that is 80% "New" reads as untouched at a glance. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {SRC_STATUSES.map(st => {
          const c = counts[st] || 0;
          const on = fStatus === st;
          const style = STATUS_STYLE[st];
          return (
            <button
              key={st}
              onClick={() => setFStatus(on ? '' : st)}
              style={{
                flex: '1 1 0', minWidth: 150, textAlign: 'left', font: 'inherit', cursor: 'pointer',
                background: NW.white, borderRadius: 13, padding: '12px 14px 10px',
                border: `1px solid ${on ? style.dot : NW.gray100}`,
                boxShadow: on ? `inset 0 0 0 1px ${style.dot}` : 'none',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: on ? style.fg : NW.black }}>{c}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: NW.gray500, marginTop: 1 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: style.dot, flexShrink: 0 }} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st}</span>
              </div>
              <div style={{ height: 3, background: NW.gray100, borderRadius: 2, marginTop: 9, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: total ? `${(c / total) * 100}%` : '0%', background: style.dot }} />
              </div>
            </button>
          );
        })}
        <div style={{ flex: '1 1 0', minWidth: 150, background: NW.offWhite, borderRadius: 13, padding: '12px 14px 10px', border: `1px solid ${NW.gray100}` }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: NW.black }}>{total}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: NW.gray500, marginTop: 1 }}>Sourced · kept</div>
          <div style={{ height: 3, background: NW.gray200, borderRadius: 2, marginTop: 9 }} />
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or LinkedIn" style={{ ...field, width: 200 }} />
        <select value={fCountry} onChange={e => setFCountry(e.target.value)} style={field}><option value="">All countries</option>{[...new Set(rows.map(r => r.country).filter(Boolean))].map(c => <option key={c}>{c}</option>)}</select>
        <select value={fOwner} onChange={e => setFOwner(e.target.value)} style={field}><option value="">All owners</option><option value="none">Unassigned</option>{SRC_OWNERS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select value={fSource} onChange={e => setFSource(e.target.value)} style={field}><option value="">All sources</option><option>X-ray</option><option>Manual</option></select>
        {runs.length > 0 && (
          <select value={fRef} onChange={e => setFRef(e.target.value)} style={field} title="Which search surfaced them">
            <option value="">All searches</option>
            {runs.map(r => <option key={r.ref} value={r.ref}>{r.ref} · {r.found} found</option>)}
          </select>
        )}
        {fRef && (() => {
          const run = runs.find(r => r.ref === fRef);
          return run ? (
            <button onClick={() => setRefDetail(run)} style={{ ...field, cursor: 'pointer', color: NW.teal700, fontWeight: 600 }}>
              What did {fRef} target?
            </button>
          ) : null;
        })()}
        {runs.length > 0 && (
          <button
            onClick={() => setGroupByRef(v => !v)}
            title="Show candidates under the search that found them"
            style={{ ...field, cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, color: groupByRef ? NW.teal700 : NW.gray700, background: groupByRef ? NW.teal50 : NW.white, borderColor: groupByRef ? NW.teal500 : NW.gray200 }}
          >
            <Icon name="layers" size={14} color={groupByRef ? NW.teal600 : NW.gray600} />
            {groupByRef ? 'Grouped by search' : 'Group by search'}
          </button>
        )}
        <button onClick={() => setModal('add')} style={{ ...field, cursor: 'pointer', fontWeight: 600, color: NW.black, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="plus" size={14} color={NW.gray600} />Add manually</button>
        {plan?.phrases?.length ? <button onClick={() => setModal('plan')} style={{ ...field, cursor: 'pointer', color: NW.gray700 }}>View plan</button> : null}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: NW.gray500 }}>{isFiltered ? `${filtered.length} of ${total}` : `${total} candidates`}</span>
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${NW.gray100}`, borderRadius: 14, overflowX: 'auto', background: NW.white }}>
        <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: 1420, fontSize: 13 }}>
          <thead>
            <tr style={{ background: NW.gray50 }}>
              {([['name', 'Candidate'], ['location', 'Location'], ['source', 'Source'], ['owner', 'Owner'], ['status', 'Status'], ['salary', 'Salary exp.'], ['applied', 'Applied'], ['last', 'Last action'], ['', 'Notes']] as const).map(([key, label], i) => {
                const active = !!key && sort?.key === key;
                return (
                  <th key={label} onClick={key ? () => toggleSort(key) : undefined} style={{ textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: active ? NW.gray700 : NW.gray400, padding: '10px 14px', whiteSpace: 'nowrap', cursor: key ? 'pointer' : 'default', userSelect: 'none', ...(key === 'status' ? { width: 340 } : {}), ...(i === 8 ? { width: 200, borderLeft: `1px solid ${NW.gray100}`, position: 'sticky', right: 0, background: NW.gray50, zIndex: 1 } : {}) }}>
                    {label}{active ? (sort!.dir === 1 ? ' ↑' : ' ↓') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map(g => (
                  <Fragment key={g.ref || '_none'}>
                    <tr>
                      <td colSpan={9} style={{ background: NW.gray50, borderTop: `2px solid ${NW.gray200}`, padding: '9px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11.5, fontWeight: 800, color: NW.teal700, background: NW.teal50, border: `1px solid ${NW.teal500}33`, borderRadius: 6, padding: '2px 7px' }}>
                            {g.ref || 'Not from a search'}
                          </span>
                          <span style={{ fontSize: 12, color: NW.gray700, fontWeight: 600 }}>
                            {g.list.length} candidate{g.list.length === 1 ? '' : 's'}
                          </span>
                          {g.run ? (
                            <>
                              <span style={{ fontSize: 11.5, color: NW.gray500 }}>
                                {new Date(g.run.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                {' · '}{(g.run.countries || []).length} countr{(g.run.countries || []).length === 1 ? 'y' : 'ies'}
                                {g.run.mode === 'ai' ? ' · AI plan rewritten' : ''}
                              </span>
                              {g.run.include && g.run.include.length > 0 && (
                                <span style={{ fontSize: 11, fontWeight: 600, color: '#047857', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 999, padding: '1px 8px' }}>
                                  +{g.run.include.join(', ')}
                                </span>
                              )}
                              {g.run.exclude && g.run.exclude.length > 0 && (
                                <span style={{ fontSize: 11, fontWeight: 600, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 999, padding: '1px 8px' }}>
                                  &minus;{g.run.exclude.join(', ')}
                                </span>
                              )}
                              <button onClick={() => setRefDetail(g.run)} style={{ font: 'inherit', fontSize: 11.5, fontWeight: 600, color: NW.teal700, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                                Details
                              </button>
                            </>
                          ) : (
                            <span style={{ fontSize: 11.5, color: NW.gray500 }}>Added by hand, or sourced before search tracking existed.</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {g.list.map(renderRow)}
                  </Fragment>
                ))
              : pageRows.map(renderRow)}
            {!filtered.length && (
              <tr><td colSpan={9} style={{ padding: '32px 14px', textAlign: 'center', color: NW.gray400, fontSize: 13 }}>{total ? 'No candidates match these filters.' : 'No one sourced yet — run AI Search or add manually.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: NW.gray500 }}>
            Rows per page
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{ ...field, height: 30, padding: '0 8px' }}>{[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select>
            <span>{(pageNum - 1) * pageSize + 1}–{Math.min(pageNum * pageSize, filtered.length)} of {filtered.length}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setPageNum(p => Math.max(1, p - 1))} disabled={pageNum <= 1} style={{ font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: `1px solid ${NW.gray200}`, background: NW.white, color: pageNum <= 1 ? NW.gray300 : NW.gray700, cursor: pageNum <= 1 ? 'default' : 'pointer' }}>Prev</button>
            <span style={{ fontSize: 12.5, color: NW.gray600 }}>Page {pageNum} of {pageCount}</span>
            <button onClick={() => setPageNum(p => Math.min(pageCount, p + 1))} disabled={pageNum >= pageCount} style={{ font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: `1px solid ${NW.gray200}`, background: NW.white, color: pageNum >= pageCount ? NW.gray300 : NW.gray700, cursor: pageNum >= pageCount ? 'default' : 'pointer' }}>Next</button>
          </div>
        </div>
      )}
      <div style={{ fontSize: 11, color: NW.gray400, marginTop: 8 }}>Applied is matched automatically from the job board by LinkedIn URL · nothing is ever deleted.</div>

      {modal === 'add' && <AddManualModal openingId={openingId} onClose={() => setModal(null)} onDone={() => setModal(null)} />}
      {modal === 'plan' && <PlanModal plan={plan} onClose={() => setModal(null)} busy={busy === 'ai'} onRerun={() => { setModal(null); runSearch('ai'); }} />}
      {notesRow && <NotesModal row={notesRow} onClose={() => setNotesRow(null)} onSave={v => { save(notesRow.id, { notes: v }); setNotesRow(null); }} />}
      {refDetail && (
        <SearchRefModal
          run={refDetail}
          onClose={() => setRefDetail(null)}
          onFilter={() => { setFRef(refDetail.ref); setRefDetail(null); }}
        />
      )}
    </div>
  );
}
