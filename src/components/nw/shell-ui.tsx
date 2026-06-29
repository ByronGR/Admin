'use client';

// ============================================================
// Nearwork Admin redesign — shared shell UI
// Faithful TS/React port of the handoff `admin-shell.jsx` primitives
// (PageHeader, Card, CardHead, StatusBadge, StageTag, ScorePill,
//  FlagChip, Table/Th/Td/TableRow, SegTabs, FilterButton, BackBar).
// ============================================================

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { type IconName } from 'lucide-react/dynamic';
import { NW, Icon, MONO } from './primitives';

// ── Page header ───────────────────────────────────────────────────────────────
export function PageHeader({
  overline,
  title,
  subtitle,
  actions,
}: {
  overline?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 26,
        flexWrap: 'wrap',
      }}
    >
      <div>
        {overline && (
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: NW.gray400,
              marginBottom: 8,
            }}
          >
            {overline}
          </div>
        )}
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: NW.black, margin: 0 }}>
          {title}
        </h1>
        {subtitle && <p style={{ fontSize: 14, color: NW.gray500, margin: '8px 0 0', maxWidth: 620 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{actions}</div>}
    </div>
  );
}

// ── Surface card ──────────────────────────────────────────────────────────────
export function Card({
  children,
  style,
  pad = 22,
  hover,
  onClick,
}: {
  children: ReactNode;
  style?: CSSProperties;
  pad?: number;
  hover?: boolean;
  onClick?: () => void;
}) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={hover ? () => setH(true) : undefined}
      onMouseLeave={hover ? () => setH(false) : undefined}
      style={{
        background: NW.white,
        border: `1px solid ${h ? NW.gray200 : NW.gray100}`,
        borderRadius: 16,
        boxShadow: h ? '0 6px 18px rgba(0,0,0,0.06)' : '0 1px 2px rgba(0,0,0,0.03)',
        padding: pad,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 130ms, border-color 130ms',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHead({
  title,
  sub,
  icon,
  action,
}: {
  title: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {icon && (
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: NW.gray50,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={icon} size={15} color={NW.gray600} />
          </span>
        )}
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: NW.black, letterSpacing: '-0.01em' }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: NW.gray500, marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ── Status & stage indicators ─────────────────────────────────────────────────
export type StatusKey =
  | 'active'
  | 'onboarding'
  | 'paused'
  | 'starting'
  | 'complete'
  | 'in-progress'
  | 'invited'
  | 'ended'
  | 'pending'
  | 'completed';

export const STATUS_STYLES: Record<StatusKey, { fg: string; bg: string; label: string }> = {
  active: { fg: NW.green600, bg: NW.green50, label: 'Active' },
  onboarding: { fg: '#1D4ED8', bg: NW.blue50, label: 'Onboarding' },
  paused: { fg: '#A16207', bg: NW.yellow50, label: 'Paused' },
  starting: { fg: NW.teal700, bg: NW.teal50, label: 'Starting soon' },
  complete: { fg: NW.green600, bg: NW.green50, label: 'Complete' },
  'in-progress': { fg: '#1D4ED8', bg: NW.blue50, label: 'In progress' },
  invited: { fg: NW.gray600, bg: NW.gray50, label: 'Invited' },
  ended: { fg: NW.gray500, bg: NW.gray50, label: 'Ended' },
  pending: { fg: '#A16207', bg: NW.yellow50, label: 'Pending approval' },
  completed: { fg: NW.gray500, bg: NW.gray50, label: 'Completed' },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS_STYLES[status as StatusKey] || STATUS_STYLES.active;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11.5,
        fontWeight: 600,
        color: s.fg,
        background: s.bg,
        border: `1px solid ${s.fg}22`,
        borderRadius: 999,
        padding: '3px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.fg }} />
      {label || s.label}
    </span>
  );
}

export const STAGE_COLORS: Record<string, string> = {
  Sourced: NW.gray400,
  Screening: NW.blue500,
  Interview: '#6366F1',
  Assessment: NW.violet500,
  'Client review': NW.yellow500,
  'Final round': NW.teal500,
  Offer: NW.rose500,
  'Not selected': NW.gray300,
};

export function StageTag({ stage }: { stage: string }) {
  const c = STAGE_COLORS[stage] || NW.gray400;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 500, color: NW.gray700, whiteSpace: 'nowrap' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
      {stage}
    </span>
  );
}

// ── Score pill (mono) ─────────────────────────────────────────────────────────
export function ScorePill({ value, size = 'md' }: { value: number | null | undefined; size?: 'sm' | 'md' }) {
  if (value == null) return <span style={{ color: NW.gray300, fontFamily: MONO, fontSize: 13 }}>—</span>;
  const color = value >= 90 ? NW.teal600 : value >= 80 ? NW.teal500 : value >= 70 ? '#A16207' : NW.gray500;
  const bg = value >= 80 ? NW.teal50 : value >= 70 ? NW.yellow50 : NW.gray50;
  const s = size === 'sm' ? { fz: 11.5, py: 2, px: 7 } : { fz: 13, py: 3, px: 9 };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        fontFamily: MONO,
        background: bg,
        color,
        border: `1px solid ${color}22`,
        fontSize: s.fz,
        fontWeight: 500,
        padding: `${s.py}px ${s.px}px`,
        borderRadius: 6,
        letterSpacing: '-0.02em',
      }}
    >
      {value}
      <span style={{ opacity: 0.45, fontSize: s.fz - 2, marginLeft: 1 }}>/100</span>
    </span>
  );
}

// ── Flag chip (hot / review / offer) ──────────────────────────────────────────
export function FlagChip({ flag }: { flag?: string | null }) {
  if (!flag) return null;
  const map: Record<string, { label: string; icon: IconName; fg: string; bg: string }> = {
    hot: { label: 'Hot', icon: 'flame', fg: NW.rose600, bg: NW.rose50 },
    review: { label: 'Needs review', icon: 'eye', fg: '#A16207', bg: NW.yellow50 },
    offer: { label: 'Offer out', icon: 'handshake', fg: NW.teal700, bg: NW.teal50 },
  };
  const m = map[flag];
  if (!m) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        color: m.fg,
        background: m.bg,
        border: `1px solid ${m.fg}22`,
        borderRadius: 999,
        padding: '2px 8px',
      }}
    >
      <Icon name={m.icon} size={11} color={m.fg} /> {m.label}
    </span>
  );
}

// ── Table primitives ──────────────────────────────────────────────────────────
export function Table({ children }: { children: ReactNode }) {
  return <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>{children}</table>;
}
export function Th({ children, align = 'left', style }: { children?: ReactNode; align?: CSSProperties['textAlign']; style?: CSSProperties }) {
  return (
    <th
      style={{
        textAlign: align,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: NW.gray400,
        padding: '0 16px 12px',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </th>
  );
}
export function Td({ children, align = 'left', style }: { children?: ReactNode; align?: CSSProperties['textAlign']; style?: CSSProperties }) {
  return (
    <td style={{ textAlign: align, padding: '14px 16px', borderTop: `1px solid ${NW.gray100}`, color: NW.gray700, verticalAlign: 'middle', ...style }}>
      {children}
    </td>
  );
}
export function TableRow({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ background: hov ? NW.gray50 : 'transparent', cursor: onClick ? 'pointer' : 'default', transition: 'background 120ms' }}
    >
      {children}
    </tr>
  );
}

// ── Segmented tabs ────────────────────────────────────────────────────────────
export function SegTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: NW.gray50, borderRadius: 10, border: `1px solid ${NW.gray100}` }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              fontSize: 12.5,
              fontWeight: on ? 600 : 500,
              cursor: 'pointer',
              border: 'none',
              color: on ? NW.black : NW.gray500,
              background: on ? NW.white : 'transparent',
              boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              borderRadius: 7,
              padding: '6px 13px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              transition: 'all 120ms',
            }}
          >
            {t.label}
            {t.count != null && <span style={{ fontFamily: MONO, fontSize: 11, color: on ? NW.teal700 : NW.gray400 }}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Filter button (dropdown trigger look) ─────────────────────────────────────
export function FilterButton({ icon, label, value, onClick }: { icon?: IconName; label?: string; value: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        cursor: 'pointer',
        background: NW.white,
        border: `1px solid ${NW.gray200}`,
        borderRadius: 9,
        padding: '8px 12px',
        color: NW.gray700,
      }}
    >
      {icon && <Icon name={icon} size={14} color={NW.gray500} />}
      {label && <span style={{ color: NW.gray500 }}>{label}:</span>}
      <span style={{ fontWeight: 600, color: NW.black }}>{value}</span>
      <Icon name="chevron-down" size={14} color={NW.gray400} />
    </button>
  );
}

// ── Back bar for detail views (uses real router) ──────────────────────────────
export function BackBar({ label = 'Back', href, onBack }: { label?: string; href?: string; onBack?: () => void }) {
  const router = useRouter();
  const [hov, setHov] = useState(false);
  function handle() {
    if (onBack) return onBack();
    if (href) return router.push(href);
    router.back();
  }
  return (
    <button
      onClick={handle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 13,
        fontWeight: 500,
        color: hov ? NW.black : NW.gray500,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '4px 0',
        marginBottom: 18,
        transition: 'color 120ms',
      }}
    >
      <Icon name="arrow-left" size={16} color={hov ? NW.black : NW.gray500} /> {label}
    </button>
  );
}
