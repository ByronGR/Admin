'use client';

// ── Client-portal candidate assessment report — ported into Admin ─────────────
// Design copied verbatim (inline styles byte-for-byte) from the client App:
//   App/src/portal/primitives.tsx  (NW palette + Icon + Avatar + MatchScore)
//   App/src/portal/screens/candidate.tsx  (the report body)
// The rich data comes from Firestore via the mapping in this route's page.tsx
// (mirrors App/src/portal/map-candidate.ts). Grading is attributed to the doc's
// `gradedBy` ("Nearwork talent team") — never AI.

import React, { useState } from 'react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';

// ── NW palette ────────────────────────────────────────────────────────────────
export const NW = {
  white: '#FFFFFF',
  black: '#111111',
  offWhite: '#F8F7F3',
  gray50: '#F5F4F0',
  gray100: '#EBEBEB',
  gray200: '#D9D9D9',
  gray300: '#BDBDBD',
  gray400: '#9E9E9E',
  gray500: '#757575',
  gray600: '#555555',
  gray700: '#383838',
  gray800: '#232323',
  gray900: '#161616',
  teal50: '#E8F8F5',
  teal100: '#C8EDE6',
  teal500: '#16A085',
  teal600: '#12866E',
  teal700: '#0E6B58',
  rose50: '#FEF0F5',
  rose500: '#E74C7C',
  rose600: '#CC3666',
  violet50: '#F7F2FC',
  violet500: '#AF7AC5',
  green50: '#F0FDF4',
  green500: '#22C55E',
  green600: '#16A34A',
  yellow50: '#FEFCE8',
  yellow500: '#EAB308',
  blue50: '#EFF6FF',
  blue500: '#3B82F6',
} as const;

type CSS = React.CSSProperties;

// ── Icon (Lucide by name, via DynamicIcon) ────────────────────────────────────
export function Icon({
  name,
  size = 16,
  color,
  strokeWidth = 1.75,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSS;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', color, ...style }}>
      <DynamicIcon name={name as IconName} size={size} strokeWidth={strokeWidth} />
    </span>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────
export function Avatar({
  initials,
  size = 32,
  bg = NW.teal500,
  fg = NW.white,
}: {
  initials?: string;
  size?: number;
  bg?: string;
  fg?: string;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

// ── Match score donut ─────────────────────────────────────────────────────────
export function MatchScore({
  value,
  size = 44,
  strokeWidth = 3.5,
  showLabel = true,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  const color = value >= 55 ? (value >= 70 ? NW.teal500 : NW.yellow500) : NW.gray400;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={NW.gray100} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      {showLabel && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: size * 0.3,
            fontWeight: 700,
            color: NW.black,
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </div>
      )}
    </div>
  );
}

// ── Typed data prop shapes (mirror App/src/portal/screens/candidate.tsx) ───────
export type CandidateDiscDim = { key: string; name: string; color: string };
export type CandidateDiscValues = { D: number; I: number; S: number; C: number };

export type CandidateHeader = {
  id: string | number;
  name: string;
  initials: string;
  avatarBg: string;
  role: string;
  location: string;
  stage: string;
  stageIdx: number;
  score: number;
  openingId: string;
  match: string[];
  note?: string;
  submittedDays: number;
};

export type CandidateSnapshot = {
  experience?: number;
  salaryExp?: string;
  availability?: string;
  timezone?: string;
};

export type CandidateEnglish = {
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  score: number;
  summary: string;
};

export type CandidateIntegrity = {
  risk: number;
  tabSwitches: number;
  copyPaste: number;
  focusLosses: number;
};

export type CandidateQuestion = {
  n: number;
  prompt: string;
  competency: string;
  score: number;
  max: number;
  answer: string;
  feedback: string;
  followUp?: { q: string; a: string };
};

export type CandidateAssessment = {
  overall: number;
  passing: number;
  status: 'passed' | 'failed';
  integrity: CandidateIntegrity;
  summary: string;
  questions: CandidateQuestion[];
};

export type CandidateDisc = {
  type: 'D' | 'I' | 'S' | 'C';
  label: string;
  classification: string;
  headline: string;
  narrative: string;
  profiles: {
    natural: CandidateDiscValues;
    adapted: CandidateDiscValues;
    pressure: CandidateDiscValues;
  };
};

export type CandidateRadar = {
  axes: string[];
  candidate: number[];
  average: number[];
  cohortSize: number;
};

export type CandidateHighlight = { label: string; detail: string };
export type CandidateHighlights = {
  strengths: CandidateHighlight[];
  watchOuts: CandidateHighlight[];
};

export type CandidateFitForRole = {
  mustHave: string[];
  niceToHave?: string[];
};

export type CandidateSubmittedMeta = {
  submitted: string;
  gradedBy: string;
};

export type CandidateData = {
  candidate: CandidateHeader;
  openingId: string;
  discColors: Record<string, string>;
  discDims: Record<string, CandidateDiscDim>;
  stageOrder: string[];
  snapshot?: CandidateSnapshot;
  fitForRole?: CandidateFitForRole;
  completed?: boolean;
  submittedMeta?: CandidateSubmittedMeta;
  english?: CandidateEnglish;
  assessment?: CandidateAssessment;
  disc?: CandidateDisc;
  radar?: CandidateRadar;
  highlights?: CandidateHighlights;
};

// ── Inline candidate avatar ───────────────────────────────────────────────────
function CandidateAvatar({ c, size = 36 }: { c: CandidateHeader; size?: number }) {
  return <Avatar initials={c.initials} size={size} bg={c.avatarBg} />;
}

// ── Small building blocks ────────────────────────────────────────────────────
function CardPanel({
  title,
  icon,
  right,
  children,
  pad = 24,
  id,
  style,
}: {
  title?: string;
  icon?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  pad?: number;
  id?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section id={id} style={{ background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 20, padding: pad, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {icon && <Icon name={icon} size={15} color={NW.gray500} />}
            <h3 style={{ fontSize: 12, fontWeight: 700, color: NW.gray500, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>{title}</h3>
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function ResultPill({ status, size = 'md' }: { status: 'passed' | 'failed'; size?: 'md' | 'lg' }) {
  const pass = status === 'passed';
  const s = size === 'lg' ? { fz: 12.5, py: 5, px: 12 } : { fz: 11, py: 4, px: 10 };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: s.fz, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: `${s.py}px ${s.px}px`, borderRadius: 999, background: pass ? NW.teal50 : NW.rose50, color: pass ? NW.teal700 : NW.rose600 }}>
      <Icon name={pass ? 'circle-check' : 'circle-x'} size={s.fz + 2} color={pass ? NW.teal600 : NW.rose500} strokeWidth={2.2} /> {pass ? 'Passed' : 'Did not pass'}
    </span>
  );
}

// The three score tiles
function ScoreTiles({ english, assessment, disc, discColors }: {
  english: CandidateEnglish;
  assessment: CandidateAssessment;
  disc: CandidateDisc;
  discColors: Record<string, string>;
}) {
  const eng = english, as = assessment;
  const pass = as.status === 'passed';
  const discColor = discColors[disc.type] || NW.gray500;
  const tile: React.CSSProperties = { flex: 1, minWidth: 220, background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column' };
  const overline: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.12em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 14 };
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
      <div style={tile}>
        <span style={overline}><Icon name="languages" size={13} color={NW.gray400} /> English · CEFR</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 38, fontWeight: 700, color: NW.black, letterSpacing: '-0.04em', lineHeight: 1 }}>{eng.level}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: NW.gray500 }}>{eng.score}%</span>
        </div>
        <div style={{ height: 6, background: NW.gray100, borderRadius: 4, overflow: 'hidden', marginTop: 14 }}>
          <div style={{ width: `${eng.score}%`, height: '100%', background: NW.teal500 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontSize: 9.5, color: NW.gray400, fontWeight: 600, letterSpacing: '0.06em' }}>
          {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(l => <span key={l} style={{ color: l === eng.level ? NW.teal600 : NW.gray400 }}>{l}</span>)}
        </div>
      </div>
      <div style={{ ...tile, background: pass ? NW.white : '#FFFBFC', borderColor: pass ? NW.gray100 : '#F3D9E2' }}>
        <span style={overline}><Icon name="clipboard-check" size={13} color={NW.gray400} /> Assessment</span>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 38, fontWeight: 700, color: pass ? NW.teal700 : NW.rose600, letterSpacing: '-0.04em', lineHeight: 1 }}>{as.overall}</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: pass ? NW.teal600 : NW.rose500 }}>%</span>
          </div>
          <ResultPill status={as.status} />
        </div>
        <div style={{ position: 'relative', height: 6, background: NW.gray100, borderRadius: 4, marginTop: 16 }}>
          <div style={{ position: 'absolute', inset: 0, width: `${as.overall}%`, height: '100%', background: pass ? NW.teal500 : NW.rose500, borderRadius: 4 }} />
          <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${as.passing}%`, width: 2, background: NW.gray500, borderRadius: 2 }} />
        </div>
        <div style={{ marginTop: 7, fontSize: 10.5, color: NW.gray400, display: 'flex', justifyContent: 'space-between' }}>
          <span>0</span><span style={{ color: NW.gray500, fontWeight: 600 }}>Pass · {as.passing}%</span><span>100</span>
        </div>
      </div>
      <div style={tile}>
        <span style={overline}><Icon name="orbit" size={13} color={NW.gray400} /> DISC profile</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={{ width: 46, height: 46, borderRadius: 12, background: `${discColor}18`, color: discColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 22, flexShrink: 0 }}>{disc.type}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: NW.black, letterSpacing: '-0.02em' }}>{disc.label}</div>
            <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 2 }}>{disc.classification}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, marginTop: 16 }}>
          {['D', 'I', 'S', 'C'].map(k => {
            const on = k === disc.type;
            const col = discColors[k];
            return <span key={k} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 700, color: on ? NW.white : NW.gray400, background: on ? col : NW.gray50, border: `1px solid ${on ? col : NW.gray100}`, padding: '5px 0', borderRadius: 7 }}>{k}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

// ── Competency radar (candidate vs cohort average) ───────────────────────────
function RadarChart({ axes, candidate, average, size = 260 }: {
  axes: string[];
  candidate: number[];
  average: number[];
  size?: number;
}) {
  const n = axes.length;
  const cx = size / 2, cy = size / 2, r = size * 0.35;
  const pt = (val: number, i: number, rad = r): [number, number] => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const rr = rad * (val / 100);
    return [cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)];
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(v, i).join(',')).join(' ');
  const rings = [25, 50, 75, 100];
  const SHORT: Record<string, string> = { 'Incident response': 'Incidents', 'Reliability & CI/CD': 'Reliability', 'Velocity & on-call': 'Velocity', 'Stakeholder comms': 'Stakeholders', 'Research & discovery': 'Research', 'Conflict resolution': 'Conflict', 'Design systems': 'Design sys.' };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible', display: 'block' }} data-om-raster>
      {/* rings */}
      {rings.map(rg => (
        <polygon key={rg} points={axes.map((_, i) => pt(rg, i).join(',')).join(' ')} fill="none" stroke={NW.gray100} strokeWidth="1" />
      ))}
      {/* spokes */}
      {axes.map((_, i) => {
        const [x, y] = pt(100, i);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={NW.gray100} strokeWidth="1" />;
      })}
      {/* average */}
      <polygon points={poly(average)} fill={NW.gray300} fillOpacity="0.18" stroke={NW.gray400} strokeWidth="1.5" strokeDasharray="4 3" />
      {/* candidate */}
      <polygon points={poly(candidate)} fill={NW.teal500} fillOpacity="0.16" stroke={NW.teal500} strokeWidth="2" strokeLinejoin="round" />
      {candidate.map((v, i) => { const [x, y] = pt(v, i); return <circle key={i} cx={x} cy={y} r="3" fill={NW.teal600} />; })}
      {/* labels */}
      {axes.map((lbl, i) => {
        const [x, y] = pt(116, i);
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const cos = Math.cos(ang);
        const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
        return <text key={i} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" style={{ fontSize: 10, fontWeight: 600, fill: NW.gray600, fontFamily: 'Poppins, sans-serif' }}>{SHORT[lbl] || lbl}</text>;
      })}
    </svg>
  );
}

function CompetencyPanel({ radar }: { radar: CandidateRadar }) {
  const delta = radar.candidate.map((v, i) => v - radar.average[i]);
  return (
    <CardPanel title="Competency profile" icon="radar">
      <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '0 0 auto', width: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 auto' }}>
          <RadarChart axes={radar.axes} candidate={radar.candidate} average={radar.average} size={252} />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 14 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: NW.gray600 }}><span style={{ width: 16, height: 3, borderRadius: 2, background: NW.teal500, display: 'inline-block' }} /> This candidate</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: NW.gray600 }}><span style={{ width: 16, height: 0, borderTop: `2px dashed ${NW.gray400}`, display: 'inline-block' }} /> Role average</span>
          </div>
        </div>
        <div style={{ flex: '1 1 340px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {radar.axes.map((lbl, i) => {
            const d = delta[i];
            const up = d >= 0;
            return (
              <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 128, flexShrink: 0, fontSize: 12.5, color: NW.gray700, fontWeight: 500 }}>{lbl}</span>
                <div style={{ flex: 1, position: 'relative', height: 8, background: NW.gray100, borderRadius: 5 }}>
                  <div style={{ position: 'absolute', inset: 0, width: `${radar.candidate[i]}%`, height: '100%', background: NW.teal500, borderRadius: 5 }} />
                  <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${radar.average[i]}%`, width: 2, background: NW.gray500, borderRadius: 2 }} title={`Avg ${radar.average[i]}`} />
                </div>
                <span style={{ width: 34, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: NW.black }}>{radar.candidate[i]}</span>
                <span style={{ width: 44, textAlign: 'right', display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, fontSize: 11, fontWeight: 600, color: d === 0 ? NW.gray400 : up ? NW.teal600 : '#A16207' }}>
                  {d !== 0 && <Icon name={up ? 'arrow-up' : 'arrow-down'} size={11} color={up ? NW.teal600 : '#A16207'} />}{d > 0 ? '+' : ''}{d}
                </span>
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: NW.gray400, marginTop: 2 }}>Benchmarked against {radar.cohortSize} candidate{radar.cohortSize === 1 ? '' : 's'} assessed for similar roles.</div>
        </div>
      </div>
    </CardPanel>
  );
}

// ── Integrity + question breakdown ───────────────────────────────────────────
function IntegrityStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 92, padding: '12px 14px', background: NW.offWhite, border: `1px solid ${NW.gray100}`, borderRadius: 12 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? '#A16207' : NW.black, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: NW.gray500, marginTop: 2, letterSpacing: '0.02em' }}>{label}</div>
    </div>
  );
}

function QuestionRow({ q, repeat }: { q: CandidateQuestion; repeat?: boolean }) {
  const [open, setOpen] = useState(false);
  const pct = (q.score / q.max);
  const col = pct >= 0.8 ? NW.teal600 : pct >= 0.6 ? NW.teal500 : pct >= 0.5 ? NW.yellow500 : NW.rose500;
  return (
    <div style={{ border: `1px solid ${NW.gray100}`, borderRadius: 14, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '15px 16px', cursor: 'pointer' }}>
        <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, background: NW.gray50, border: `1px solid ${NW.gray100}`, color: NW.gray600, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>Q{q.n}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {q.competency && <div style={{ fontSize: 10, fontWeight: 700, color: NW.teal600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{q.competency}</div>}
          <p style={{ fontSize: 13.5, color: NW.gray800, lineHeight: 1.5, margin: 0, fontWeight: 500 }}>{q.prompt}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: col }}>{q.score.toFixed(1)}<span style={{ color: NW.gray400, fontWeight: 400 }}>/{q.max}</span></span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={NW.gray400} />
        </div>
      </div>
      <div style={{ height: 3, background: NW.gray100, margin: '0 16px' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: col }} />
      </div>
      {open && (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 14, animation: 'nwFade 160ms ease' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>Candidate answer</div>
            <p style={{ fontSize: 13, color: NW.gray700, lineHeight: 1.6, margin: 0, padding: '12px 14px', background: NW.offWhite, borderRadius: 10, borderLeft: `3px solid ${NW.gray200}` }}>{q.answer}</p>
          </div>
          {q.followUp && (
            <div style={{ paddingLeft: 14, borderLeft: `2px solid ${NW.gray100}` }}>
              <div style={{ fontSize: 12, color: NW.gray600, fontStyle: 'italic', marginBottom: 6 }}><span style={{ fontWeight: 600, fontStyle: 'normal', color: NW.gray500 }}>Follow-up · </span>{q.followUp.q}</div>
              <p style={{ fontSize: 12.5, color: NW.gray700, lineHeight: 1.55, margin: 0 }}>{q.followUp.a}</p>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, padding: '12px 14px', background: repeat ? NW.rose50 : NW.teal50, border: `1px solid ${repeat ? '#E74C7C22' : '#16A08522'}`, borderRadius: 10 }}>
            <Icon name={repeat ? 'triangle-alert' : 'message-square-quote'} size={15} color={repeat ? NW.rose600 : NW.teal600} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: repeat ? NW.rose600 : NW.teal700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Assessor feedback</div>
              <p style={{ fontSize: 12.5, color: NW.gray700, lineHeight: 1.55, margin: 0 }}>{q.feedback}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiscProfileCard({ title, note, values, primary, discDims }: {
  title: string;
  note: string;
  values: CandidateDiscValues;
  primary: string;
  discDims: Record<string, CandidateDiscDim>;
}) {
  return (
    <div style={{ flex: 1, minWidth: 200, padding: 18, background: NW.offWhite, border: `1px solid ${NW.gray100}`, borderRadius: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: NW.black }}>{title}</div>
      <div style={{ fontSize: 11, color: NW.gray500, marginTop: 2, marginBottom: 16 }}>{note}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {(['D', 'I', 'S', 'C'] as const).map(k => {
          const dim = discDims[k];
          const v = values[k];
          const on = k === primary;
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 16, fontSize: 11.5, fontWeight: 700, color: dim.color }}>{k}</span>
              <div style={{ flex: 1, height: 8, background: NW.gray100, borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${v}%`, height: '100%', background: dim.color, opacity: on ? 1 : 0.5, borderRadius: 5 }} />
              </div>
              <span style={{ width: 30, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: NW.gray600 }}>p{v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Right-column panels ──────────────────────────────────────────────────────
function SnapshotPanel({ c, x }: { c: CandidateHeader; x: CandidateSnapshot }) {
  const rows = [
    { icon: 'briefcase', l: 'Experience', v: x.experience != null ? `${x.experience} yrs` : '—' },
    { icon: 'wallet', l: 'Salary expectation', v: x.salaryExp ? `${x.salaryExp} / mo` : '—' },
    { icon: 'calendar-clock', l: 'Availability', v: x.availability || '—' },
    { icon: 'clock', l: 'Timezone', v: x.timezone || '—' },
    { icon: 'inbox', l: 'Applied', v: c.submittedDays === 0 ? 'Today' : `${c.submittedDays}d ago` },
  ];
  return (
    <CardPanel title="Snapshot" icon="id-card">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((r, i) => (
          <div key={r.l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${NW.gray100}` }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: NW.gray500 }}><Icon name={r.icon} size={13} color={NW.gray400} /> {r.l}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: NW.black }}>{r.v}</span>
          </div>
        ))}
      </div>
    </CardPanel>
  );
}

function SkillsMatchPanel({ c, fit }: { c: CandidateHeader; fit?: CandidateFitForRole }) {
  if (!fit) return null;
  const has = (skill: string) => (c.match || []).some(m => m.toLowerCase() === skill.toLowerCase());
  const matched = fit.mustHave.filter(has).length;
  const niceMatched = (fit.niceToHave || []).filter(has);
  return (
    <CardPanel title="Fit for role" icon="target"
      right={<span style={{ fontSize: 11, fontWeight: 600, color: matched === fit.mustHave.length ? NW.teal700 : NW.gray600, background: matched === fit.mustHave.length ? NW.teal50 : NW.gray50, padding: '3px 10px', borderRadius: 999 }}>{matched}/{fit.mustHave.length} must-haves</span>}>
      <div style={{ fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Must-have skills</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {fit.mustHave.map(s => {
          const ok = has(s);
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 20, height: 20, borderRadius: 6, background: ok ? NW.teal50 : NW.gray50, border: `1px solid ${ok ? '#16A08533' : NW.gray100}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={ok ? 'check' : 'minus'} size={12} color={ok ? NW.teal600 : NW.gray400} strokeWidth={2.5} />
              </span>
              <span style={{ fontSize: 13, color: ok ? NW.gray800 : NW.gray400, fontWeight: ok ? 500 : 400 }}>{s}</span>
              {!ok && <span style={{ marginLeft: 'auto', fontSize: 10.5, color: NW.gray400 }}>not shown</span>}
            </div>
          );
        })}
      </div>
      {niceMatched.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '16px 0 10px' }}>Bonus · nice to have</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {niceMatched.map(s => <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 500, color: NW.teal700, background: NW.teal50, border: '1px solid #16A08522', padding: '4px 10px', borderRadius: 999 }}><Icon name="plus" size={11} color={NW.teal600} />{s}</span>)}
          </div>
        </>
      )}
    </CardPanel>
  );
}

function HighlightsPanel({ h }: { h: CandidateHighlights }) {
  return (
    <CardPanel title="Strengths & watch-outs" icon="scale">
      <div style={{ fontSize: 10, fontWeight: 700, color: NW.teal700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Strengths</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {h.strengths.length ? h.strengths.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <Icon name="check" size={15} color={NW.teal600} strokeWidth={2.5} style={{ marginTop: 1, flexShrink: 0 }} />
            <div><div style={{ fontSize: 13, fontWeight: 600, color: NW.gray800 }}>{s.label}</div><div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 1 }}>{s.detail}</div></div>
          </div>
        )) : <div style={{ fontSize: 12.5, color: NW.gray400 }}>No standout strengths flagged.</div>}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#A16207', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '18px 0 10px' }}>Watch-outs</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {h.watchOuts.length ? h.watchOuts.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <Icon name="triangle-alert" size={15} color="#A16207" strokeWidth={2.2} style={{ marginTop: 1, flexShrink: 0 }} />
            <div><div style={{ fontSize: 13, fontWeight: 600, color: NW.gray800 }}>{s.label}</div><div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 1 }}>{s.detail}</div></div>
          </div>
        )) : <div style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12.5, color: NW.gray500 }}><Icon name="check-circle" size={15} color={NW.teal600} /> No significant gaps flagged.</div>}
      </div>
    </CardPanel>
  );
}

function EnglishPanel({ eng }: { eng: CandidateEnglish }) {
  return (
    <CardPanel title="English · CEFR" icon="languages">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <span style={{ width: 52, height: 52, borderRadius: 14, background: NW.teal50, color: NW.teal700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', flexShrink: 0 }}>{eng.level}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: NW.gray700 }}>Overall level</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: NW.black }}>{eng.score}%</span>
          </div>
          <div style={{ height: 7, background: NW.gray100, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${eng.score}%`, height: '100%', background: NW.teal500 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9.5, color: NW.gray400, fontWeight: 600 }}>
            {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(l => <span key={l} style={{ color: l === eng.level ? NW.teal600 : NW.gray400 }}>{l}</span>)}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: NW.gray700, lineHeight: 1.6, margin: 0 }}>{eng.summary}</p>
    </CardPanel>
  );
}

function DiscSummaryPanel({ disc, discColor }: { disc: CandidateDisc; discColor: string }) {
  return (
    <CardPanel title="DISC behavioral profile" icon="orbit">
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 13 }}>
        <span style={{ width: 48, height: 48, borderRadius: 12, background: `${discColor}18`, color: discColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, flexShrink: 0 }}>{disc.type}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: NW.black, letterSpacing: '-0.02em' }}>{disc.classification}</div>
          <div style={{ fontSize: 12, color: NW.gray500, marginTop: 2 }}>{disc.label} ({disc.type})</div>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: NW.gray600, lineHeight: 1.6, margin: 0 }}>{disc.headline}</p>
    </CardPanel>
  );
}

// ── Pending state ────────────────────────────────────────────────────────────
export function AssessmentPending({ c }: { c: CandidateHeader }) {
  return (
    <CardPanel title="Assessments" icon="clipboard-list">
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ width: 52, height: 52, borderRadius: 15, background: NW.gray50, border: `1px solid ${NW.gray100}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <Icon name="hourglass" size={22} color={NW.gray400} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: NW.gray700 }}>Assessment not completed yet</div>
        <p style={{ fontSize: 13, color: NW.gray500, marginTop: 6, maxWidth: 380, marginInline: 'auto', lineHeight: 1.55 }}>
          {c.name.split(' ')[0]} has been invited to the English, role, and DISC assessments. Results appear here automatically the moment they&rsquo;re submitted.
        </p>
        <div style={{ display: 'inline-flex', gap: 8, marginTop: 18 }}>
          {['English · CEFR', 'Assessment', 'DISC'].map(t => (
            <span key={t} style={{ fontSize: 11, fontWeight: 600, color: NW.gray500, background: NW.gray50, border: `1px solid ${NW.gray100}`, padding: '5px 11px', borderRadius: 999 }}>{t}</span>
          ))}
        </div>
      </div>
    </CardPanel>
  );
}

// ── Report body (no shell) ────────────────────────────────────────────────────
export function CandidateReportBody({ data }: { data: CandidateData }) {
  const c = data.candidate;

  // The rich assessment renders only when every panel it depends on is present.
  const english = data.english;
  const assessment = data.assessment;
  const disc = data.disc;
  const completed = data.completed !== false && !!english && !!assessment && !!disc;
  const radar = completed ? data.radar : undefined;
  const highlights = completed ? data.highlights : undefined;
  const x: CandidateSnapshot = data.snapshot || {};

  const stageColors: Record<number, string> = { 1: NW.gray400, 2: NW.violet500, 3: NW.teal500, 4: NW.teal600, 5: NW.rose500, 6: '#94A3B8' };
  const stageCol = stageColors[c.stageIdx] || NW.gray400;
  const discColor = completed && disc ? (data.discColors[disc.type] || NW.gray500) : NW.gray500;

  return (
    <>
      {/* Header */}
      <div style={{ background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 22, padding: 30, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
            <CandidateAvatar c={c} size={70} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 31, fontWeight: 700, color: NW.black, letterSpacing: '-0.03em', margin: 0 }}>{c.name}</h1>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: NW.gray700, background: NW.gray50, border: `1px solid ${NW.gray100}`, padding: '5px 11px', borderRadius: 999 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: stageCol }} /> {c.stage}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14.5, color: NW.gray700, fontWeight: 500 }}>{c.role}</span>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: NW.gray300 }} />
                <span style={{ fontSize: 13, color: NW.gray500, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="map-pin" size={13} color={NW.gray400} /> {c.location}</span>
                {x.experience != null && <><span style={{ width: 3, height: 3, borderRadius: '50%', background: NW.gray300 }} /><span style={{ fontSize: 13, color: NW.gray500 }}>{x.experience} yrs exp</span></>}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {(c.match || []).map(s => <span key={s} style={{ fontSize: 11, fontWeight: 500, color: NW.gray700, background: NW.gray50, border: `1px solid ${NW.gray100}`, padding: '3px 9px', borderRadius: 7 }}>{s}</span>)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Nearwork match</div>
              <div style={{ fontSize: 12, color: NW.gray500, marginTop: 2 }}>Overall fit score</div>
            </div>
            <MatchScore value={c.score} size={58} strokeWidth={4.5} />
          </div>
        </div>
      </div>

      {!completed || !english || !assessment || !disc ? (
        <AssessmentPending c={c} />
      ) : (
        <>
          {/* Submitted meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: NW.gray500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="calendar-check" size={13} color={NW.gray400} /> Submitted {data.submittedMeta?.submitted ?? 'Jun 2026'}</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: NW.gray300 }} />
            <span style={{ fontSize: 12, color: NW.gray500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="user-check" size={13} color={NW.gray400} /> Reviewed by {data.submittedMeta?.gradedBy ?? 'Nearwork talent team'}</span>
          </div>

          {/* Score tiles */}
          <ScoreTiles english={english} assessment={assessment} disc={disc} discColors={data.discColors} />

          {/* Competency radar */}
          {radar && <div style={{ marginBottom: 20 }}><CompetencyPanel radar={radar} /></div>}

          {/* Two-column body */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 20, alignItems: 'start', marginBottom: 20 }}>
            {/* Left — assessment report + language / behaviour */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <CardPanel title="Assessment report" icon="clipboard-check"
                right={<ResultPill status={assessment.status} size="lg" />}>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
                  <div style={{ flex: '1 1 210px', display: 'flex', alignItems: 'center', gap: 18, padding: '18px 20px', background: assessment.status === 'passed' ? NW.teal50 : NW.rose50, border: `1px solid ${assessment.status === 'passed' ? '#16A08522' : '#E74C7C22'}`, borderRadius: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                      <span style={{ fontSize: 46, fontWeight: 700, color: assessment.status === 'passed' ? NW.teal700 : NW.rose600, letterSpacing: '-0.04em', lineHeight: 1 }}>{assessment.overall}</span>
                      <span style={{ fontSize: 20, fontWeight: 600, color: assessment.status === 'passed' ? NW.teal600 : NW.rose500 }}>%</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: NW.gray700 }}>Overall score</div>
                      <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 2 }}>Passing score · {assessment.passing}%</div>
                    </div>
                  </div>
                  <div style={{ flex: '2 1 320px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Integrity check</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: assessment.integrity.risk >= 30 ? '#A16207' : NW.teal700, background: assessment.integrity.risk >= 30 ? NW.yellow50 : NW.teal50, padding: '3px 10px', borderRadius: 999 }}>Risk {assessment.integrity.risk}%</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <IntegrityStat label="Tab switches" value={assessment.integrity.tabSwitches} warn={assessment.integrity.tabSwitches >= 3} />
                      <IntegrityStat label="Copy-paste events" value={assessment.integrity.copyPaste} warn={assessment.integrity.copyPaste >= 1} />
                      <IntegrityStat label="Focus losses" value={assessment.integrity.focusLosses} warn={assessment.integrity.focusLosses >= 3} />
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 9 }}>Summary</div>
                <p style={{ fontSize: 14, color: NW.gray800, lineHeight: 1.65, margin: '0 0 22px' }}>{assessment.summary}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Question breakdown</span>
                  <span style={{ fontSize: 11, color: NW.gray400 }}>{assessment.questions.length} questions · tap to expand</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {assessment.questions.map((q, i) => <QuestionRow key={q.n} q={q} repeat={i === assessment.questions.length - 1 && /word-for-word|verbatim/i.test(q.feedback)} />)}
                </div>
              </CardPanel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <EnglishPanel eng={english} />
                <DiscSummaryPanel disc={disc} discColor={discColor} />
              </div>
            </div>

            {/* Right — context rail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <SnapshotPanel c={c} x={x} />
              <SkillsMatchPanel c={c} fit={data.fitForRole} />
              {highlights && <HighlightsPanel h={highlights} />}
            </div>
          </div>

          {/* DISC profiles — full width */}
          <CardPanel title="DISC profiles · Natural · Adapted · Under pressure" icon="activity">
            <p style={{ fontSize: 12.5, color: NW.gray500, margin: '0 0 18px', lineHeight: 1.55 }}>
              Percentiles across the four dimensions in three contexts. <strong style={{ color: NW.gray700, fontWeight: 600 }}>Natural</strong> is the instinctive style, <strong style={{ color: NW.gray700, fontWeight: 600 }}>Adapted</strong> is how they flex at work, and <strong style={{ color: NW.gray700, fontWeight: 600 }}>Under pressure</strong> is their default when stressed.
            </p>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <DiscProfileCard title="Natural" note="Instinctive behaviour" values={disc.profiles.natural} primary={disc.type} discDims={data.discDims} />
              <DiscProfileCard title="Adapted" note="Style flexed at work" values={disc.profiles.adapted} primary={disc.type} discDims={data.discDims} />
              <DiscProfileCard title="Under pressure" note="Default when stressed" values={disc.profiles.pressure} primary={disc.type} discDims={data.discDims} />
            </div>
            {disc.narrative && (
              <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${NW.gray100}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: NW.gray400, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>What this means</div>
                <p style={{ fontSize: 13, color: NW.gray700, lineHeight: 1.65, margin: 0 }}>{disc.narrative}</p>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '10px 13px', background: NW.gray50, border: `1px solid ${NW.gray100}`, borderRadius: 11 }}>
              <Icon name="info" size={13} color={NW.gray400} />
              <span style={{ fontSize: 11.5, color: NW.gray500, lineHeight: 1.45 }}>Psychometric results are interpretive aids. Hiring decisions should not rely solely on a single instrument.</span>
            </div>
          </CardPanel>
        </>
      )}
    </>
  );
}
