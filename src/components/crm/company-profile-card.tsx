'use client';

// ============================================================
// Company profile — the "who are they" block on the client HQ (Overview tab):
// relationship stage, size, HQ, time zone, industry, LinkedIn, funding stage.
// Writes straight onto the organization document.
// ============================================================

import { useState } from 'react';
import { db, doc, updateDoc, serverTimestamp } from '@/lib/firebase';
import { NW, Button } from '@/components/nw/primitives';
import { Card, CardHead } from '@/components/nw/shell-ui';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { COMPANY_STAGE_LABELS, type CompanyStage, type CrmSource, type Organization } from '@/lib/types';
import { crmField, Field, Pill, saveErrorMessage } from './ui';

const STAGE_STYLE: Record<CompanyStage, { fg: string; bg: string }> = {
  prospect: { fg: '#1D4ED8', bg: '#EFF6FF' },
  client: { fg: NW.teal700, bg: NW.teal50 },
  past_client: { fg: NW.gray600, bg: NW.gray50 },
};
const SOURCE_LABELS: Record<CrmSource, string> = {
  radar: 'Handed over from Radar',
  bookings: 'Booked a meeting',
  manual: 'Added by staff',
  hubspot: 'Imported from HubSpot',
};

function sizeLabel(org: Organization): string {
  if (org.employeeCount) return `${org.employeeCount.toLocaleString('en-US')} employees`;
  if (org.sizeRange) return `${org.sizeRange} employees`;
  return '—';
}

export function CompanyProfileCard({ org, onUpdated }: { org: Organization; onUpdated: (o: Organization) => void }) {
  const [editing, setEditing] = useState(false);
  const stage = org.companyStage;
  const rows: [string, React.ReactNode][] = [
    ['Company size', sizeLabel(org)],
    ['Headquarters', [org.city, org.country].filter(Boolean).join(', ') || '—'],
    ['Time zone', org.timeZone || '—'],
    ['Industry', org.industry || '—'],
    ['Funding stage', org.fundingStage || '—'],
    ['Website', org.website ? <a href={org.website.startsWith('http') ? org.website : `https://${org.website}`} target="_blank" rel="noreferrer" style={{ color: NW.teal600 }}>{org.website.replace(/^https?:\/\//, '')}</a> : '—'],
    ['LinkedIn', org.linkedin ? <a href={org.linkedin} target="_blank" rel="noreferrer" style={{ color: NW.teal600 }}>Open profile</a> : '—'],
  ];

  return (
    <Card pad={18}>
      <CardHead
        icon="building"
        title="Company profile"
        sub={org.crmSource ? SOURCE_LABELS[org.crmSource] : undefined}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {stage && <Pill fg={STAGE_STYLE[stage].fg} bg={STAGE_STYLE[stage].bg}>{COMPANY_STAGE_LABELS[stage]}</Pill>}
            <Button variant="secondary" size="sm" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>
          </div>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '14px 22px' }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: NW.gray500 }}>{k}</div>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: NW.black, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
          </div>
        ))}
      </div>
      {editing && <ProfileModal org={org} onClose={() => setEditing(false)} onSaved={(o) => { setEditing(false); onUpdated(o); }} />}
    </Card>
  );
}

function ProfileModal({ org, onClose, onSaved }: { org: Organization; onClose: () => void; onSaved: (o: Organization) => void }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    companyStage: org.companyStage ?? '',
    employeeCount: org.employeeCount ? String(org.employeeCount) : '',
    sizeRange: org.sizeRange ?? '',
    city: org.city ?? '',
    country: org.country ?? '',
    timeZone: org.timeZone ?? '',
    industry: org.industry ?? '',
    fundingStage: org.fundingStage ?? '',
    website: org.website ?? '',
    linkedin: org.linkedin ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true);
    const count = parseInt(f.employeeCount.replace(/[^0-9]/g, ''), 10);
    const patch = {
      companyStage: (f.companyStage || null) as CompanyStage | null,
      employeeCount: Number.isFinite(count) ? count : null,
      sizeRange: f.sizeRange.trim() || null,
      city: f.city.trim() || null,
      country: f.country.trim() || null,
      timeZone: f.timeZone.trim() || null,
      industry: f.industry.trim() || null,
      fundingStage: f.fundingStage.trim() || null,
      website: f.website.trim() || null,
      linkedin: f.linkedin.trim() || null,
    };
    try {
      await updateDoc(doc(db, 'organizations', org.id), { ...patch, updatedAt: serverTimestamp() });
      // Firestore stores nulls; the in-memory org uses undefined for "not set".
      const next = { ...org } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) next[k] = v ?? undefined;
      onSaved(next as unknown as Organization);
      showToast('Company profile saved');
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Company profile" size="lg">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Stage">
          <select style={crmField} value={f.companyStage} onChange={(e) => set('companyStage', e.target.value)}>
            <option value="">Not set</option>
            {(Object.keys(COMPANY_STAGE_LABELS) as CompanyStage[]).map((s) => <option key={s} value={s}>{COMPANY_STAGE_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="Funding stage"><input style={crmField} value={f.fundingStage} placeholder="Series A" onChange={(e) => set('fundingStage', e.target.value)} /></Field>
        <Field label="Employees (exact)"><input style={crmField} value={f.employeeCount} inputMode="numeric" placeholder="120" onChange={(e) => set('employeeCount', e.target.value)} /></Field>
        <Field label="Or a range"><input style={crmField} value={f.sizeRange} placeholder="51-200" onChange={(e) => set('sizeRange', e.target.value)} /></Field>
        <Field label="HQ city"><input style={crmField} value={f.city} placeholder="Austin" onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="HQ country"><input style={crmField} value={f.country} placeholder="United States" onChange={(e) => set('country', e.target.value)} /></Field>
        <Field label="Time zone"><input style={crmField} value={f.timeZone} placeholder="America/Chicago" onChange={(e) => set('timeZone', e.target.value)} /></Field>
        <Field label="Industry"><input style={crmField} value={f.industry} placeholder="Fintech" onChange={(e) => set('industry', e.target.value)} /></Field>
        <Field label="Website"><input style={crmField} value={f.website} placeholder="acme.com" onChange={(e) => set('website', e.target.value)} /></Field>
        <Field label="LinkedIn"><input style={crmField} value={f.linkedin} placeholder="https://www.linkedin.com/company/acme" onChange={(e) => set('linkedin', e.target.value)} /></Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}
