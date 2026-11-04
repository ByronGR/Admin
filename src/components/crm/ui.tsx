'use client';

// Small presentational pieces shared by the Atlas CRM screens.

import { type CSSProperties, type ReactNode } from 'react';
import { type IconName } from 'lucide-react/dynamic';
import { NW, Icon } from '@/components/nw/primitives';
import { DEAL_STAGE_STYLE } from '@/lib/crm';
import type { DealStage } from '@/lib/types';

export const crmField: CSSProperties = {
  width: '100%', fontSize: 13.5, padding: '9px 12px', border: `1px solid ${NW.gray200}`,
  borderRadius: 10, background: NW.white, color: NW.black, outline: 'none', boxSizing: 'border-box',
};
export const crmLabel: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
  color: NW.gray500, marginBottom: 6,
};
export const overline: CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: NW.gray400,
};

export function Field({ label, children, span }: { label: string; children: ReactNode; span?: boolean }) {
  return (
    <div style={span ? { gridColumn: '1 / -1' } : undefined}>
      <label style={crmLabel}>{label}</label>
      {children}
    </div>
  );
}

export function Pill({ children, fg, bg }: { children: ReactNode; fg: string; bg: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: fg, background: bg, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

export function DealStagePill({ stage }: { stage: DealStage }) {
  const s = DEAL_STAGE_STYLE[stage] || DEAL_STAGE_STYLE.Prospect;
  return (
    <Pill fg={s.fg} bg={s.bg}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.fg }} />{stage}
    </Pill>
  );
}

export function Empty({ icon, title, sub, action }: { icon: IconName; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 16px', background: NW.gray50, borderRadius: 12 }}>
      <Icon name={icon} size={22} color={NW.gray400} />
      <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black, marginTop: 8 }}>{title}</div>
      {sub && <div style={{ fontSize: 12.5, color: NW.gray500, marginTop: 4, maxWidth: 420, marginInline: 'auto' }}>{sub}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Stat({ label, value, color, sub }: { label: string; value: ReactNode; color?: string; sub?: ReactNode }) {
  return (
    <div>
      <div style={overline}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: color || NW.black, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ fontSize: 12, fontWeight: 600, color: NW.teal600, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
      {children}
    </button>
  );
}

// A save error usually means the Firestore rules for the new collections
// haven't been published yet — say so instead of a bare "failed".
export function saveErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return /permission/i.test(msg)
    ? 'Permission denied: the Firestore rules for this section are not published yet.'
    : 'Could not save. ' + msg;
}
