'use client';

// ============================================================
// Company profile — the "who are they" block on the client HQ (Overview tab):
// relationship stage, size, HQ, time zone, industry, LinkedIn, funding stage.
// Writes straight onto the organization document.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { db, auth, doc, updateDoc, serverTimestamp } from '@/lib/firebase';
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
  const [lookingUp, setLookingUp] = useState(false);
  const stage = org.companyStage;
  const rows: [string, React.ReactNode][] = [
    ['Company size', sizeLabel(org)],
    ['Headquarters', [org.city, org.region, org.country].filter(Boolean).join(', ') || '—'],
    ['Time zone', org.timeZone || '—'],
    ['Industry', org.industry || '—'],
    ['Funding stage', org.fundingStage || '—'],
    ['Founded', org.founded ? String(org.founded) : '—'],
    ['Website', org.website ? <a href={org.website.startsWith('http') ? org.website : `https://${org.website}`} target="_blank" rel="noreferrer" style={{ color: NW.teal600 }}>{org.website.replace(/^https?:\/\//, '')}</a> : '—'],
    ['LinkedIn', org.linkedin ? <a href={org.linkedin} target="_blank" rel="noreferrer" style={{ color: NW.teal600 }}>Open profile</a> : '—'],
  ];

  return (
    <Card pad={18}>
      <CardHead
        icon="building"
        title="Company profile"
        sub={[org.crmSource ? SOURCE_LABELS[org.crmSource] : null, org.enrichedAt ? `Filled from web ${new Date(org.enrichedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : null].filter(Boolean).join(' · ') || undefined}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {stage && <Pill fg={STAGE_STYLE[stage].fg} bg={STAGE_STYLE[stage].bg}>{COMPANY_STAGE_LABELS[stage]}</Pill>}
            <span title={org.website ? 'Look this company up by its website' : 'Add a website first'}>
              <Button variant="secondary" size="sm" icon="globe" disabled={!org.website} onClick={() => setLookingUp(true)}>Fill from web</Button>
            </span>
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
      {lookingUp && <LookupModal org={org} onClose={() => setLookingUp(false)} onSaved={(o) => { setLookingUp(false); onUpdated(o); }} />}
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
    region: org.region ?? '',
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
      region: f.region.trim() || null,
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
        <Field label="HQ state / region"><input style={crmField} value={f.region} placeholder="Texas" onChange={(e) => set('region', e.target.value)} /></Field>
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

// ── Fill from web (People Data Labs) ──────────────────────────────────────────
type Found = {
  name?: string; employeeCount?: number; sizeRange?: string; industry?: string; city?: string; region?: string;
  country?: string; linkedin?: string; founded?: number; fundingStage?: string;
};
const LOOKUP_FIELDS: { key: keyof Found & keyof Organization; label: string }[] = [
  { key: 'employeeCount', label: 'Employees' },
  { key: 'sizeRange', label: 'Size range' },
  { key: 'industry', label: 'Industry' },
  { key: 'city', label: 'HQ city' },
  { key: 'region', label: 'HQ state / region' },
  { key: 'country', label: 'HQ country' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'fundingStage', label: 'Funding stage' },
  { key: 'founded', label: 'Founded' },
];
const REASONS: Record<string, string> = {
  not_configured: 'The company lookup isn\u2019t switched on yet: the People Data Labs key hasn\u2019t been added to Vercel.',
  not_found: 'No match for this website. Nothing was charged. Check the website, or fill the details in by hand.',
  out_of_credits: 'This month\u2019s 100 free lookups are used up. They reset next month.',
  bad_key: 'People Data Labs rejected the key. Check PDL_API_KEY in Vercel.',
  rate_limited: 'Too many lookups in the last minute (free plan: 10 a minute). Try again shortly.',
  no_website: 'Add the company\u2019s website first.',
  unauthorized: 'Your sign-in expired. Refresh the page and try again.',
};

function LookupModal({ org, onClose, onSaved }: { org: Organization; onClose: () => void; onSaved: (o: Organization) => void }) {
  const { showToast } = useToast();
  const [state, setState] = useState<'loading' | 'found' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const ran = useRef(false);

  // Run the lookup exactly once when the window opens (the ref stops React's
  // development double-run from spending a second lookup).
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const r = await fetch(`/api/company-lookup?website=${encodeURIComponent(org.website || '')}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const j = await r.json().catch(() => ({ ok: false, reason: 'error' }));
        if (!j.ok) { setMessage(REASONS[j.reason] || 'The lookup failed. Try again in a minute.'); setState('error'); return; }
        const c = j.company as Found;
        setFound(c);
        // Pre-tick what fills a gap; leave anything staff already typed unticked.
        setPicked(new Set(LOOKUP_FIELDS.filter(({ key }) => c[key] != null && c[key] !== '' && (org[key] == null || org[key] === '')).map(({ key }) => key)));
        setState('found');
      } catch {
        setMessage('The lookup failed. Check your connection and try again.');
        setState('error');
      }
    })();
  }, [org]);

  async function apply() {
    if (!found) return;
    setSaving(true);
    const patch: Record<string, unknown> = { enrichedAt: new Date().toISOString() };
    for (const k of picked) patch[k] = found[k as keyof Found];
    try {
      await updateDoc(doc(db, 'organizations', org.id), { ...patch, updatedAt: serverTimestamp() });
      onSaved({ ...org, ...patch } as Organization);
      showToast(picked.size ? `Updated ${picked.size} field${picked.size === 1 ? '' : 's'}` : 'Lookup saved');
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
      setSaving(false);
    }
  }

  const rows = found ? LOOKUP_FIELDS.filter(({ key }) => found[key] != null && found[key] !== '') : [];
  return (
    <Modal open onClose={onClose} title="Fill from web" size="lg">
      {state === 'loading' && <div style={{ fontSize: 13.5, color: NW.gray600, padding: '10px 0' }}>Looking up {org.website}…</div>}
      {state === 'error' && <div style={{ fontSize: 13.5, color: NW.gray700, background: NW.gray50, borderRadius: 10, padding: '12px 14px' }}>{message}</div>}
      {state === 'found' && found && (
        <>
          <div style={{ fontSize: 13, color: NW.gray600, marginBottom: 12 }}>
            Found <strong style={{ color: NW.black }}>{found.name || org.website}</strong> on People Data Labs. Tick what to save.
          </div>
          {rows.length === 0 ? (
            <div style={{ fontSize: 13, color: NW.gray500 }}>The match had no profile details to add.</div>
          ) : (
            <div style={{ border: `1px solid ${NW.gray100}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '28px 130px 1fr 1fr', gap: 10, padding: '8px 12px', background: NW.gray50, fontSize: 11, fontWeight: 600, color: NW.gray500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <span /><span>Field</span><span>Now</span><span>Found</span>
              </div>
              {rows.map(({ key, label }) => {
                const now = org[key];
                const val = found[key];
                const on = picked.has(key);
                return (
                  <label key={key} style={{ display: 'grid', gridTemplateColumns: '28px 130px 1fr 1fr', gap: 10, padding: '9px 12px', borderTop: `1px solid ${NW.gray100}`, fontSize: 13, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={on} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(key); else n.delete(key); return n; })} />
                    <span style={{ color: NW.gray600 }}>{label}</span>
                    <span style={{ color: now != null && now !== '' ? NW.black : NW.gray400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{now != null && now !== '' ? String(now) : 'Empty'}</span>
                    <span style={{ color: NW.black, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key === 'employeeCount' ? Number(val).toLocaleString('en-US') : String(val)}</span>
                  </label>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: NW.gray400, marginTop: 10 }}>Free plan: 100 lookups a month; a lookup only counts when a company is found.</div>
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <Button variant="secondary" onClick={onClose}>{state === 'found' ? 'Cancel' : 'Close'}</Button>
        {state === 'found' && <Button onClick={apply} disabled={saving}>{saving ? 'Saving…' : picked.size ? `Save ${picked.size} field${picked.size === 1 ? '' : 's'}` : 'Save'}</Button>}
      </div>
    </Modal>
  );
}
