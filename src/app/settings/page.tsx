'use client';

import { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { APP_VERSION } from '@/lib/version';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, updateDoc, serverTimestamp } from '@/lib/firebase';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/spinner';
import Link from 'next/link';
import { NW, Icon, Button, Chip } from '@/components/nw/primitives';
import { PageHeader, Card, CardHead } from '@/components/nw/shell-ui';
import { type IconName } from 'lucide-react/dynamic';

function ToggleRow({ title, desc, defaultOn = false }: { title: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '15px 0', borderTop: `1px solid ${NW.gray100}` }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: NW.black }}>{title}</div>
        <div style={{ fontSize: 12.5, color: NW.gray500, marginTop: 2 }}>{desc}</div>
      </div>
      <button onClick={() => setOn(!on)} style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: on ? NW.teal500 : NW.gray200, position: 'relative', transition: 'background 160ms' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: '50%', background: NW.white, boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left 160ms' }} />
      </button>
    </div>
  );
}

type Section = 'general' | 'notifications' | 'team' | 'integrations' | 'billing';

export default function SettingsPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [section, setSection] = useState<Section>('general');
  const [calendlyLink, setCalendlyLink] = useState(profile?.calendlyLink ?? '');
  const [savingCalendly, setSavingCalendly] = useState(false);

  async function saveCalendly() {
    if (!user) return;
    setSavingCalendly(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { calendlyLink: calendlyLink.trim(), updatedAt: serverTimestamp() });
      showToast('Calendly link saved', 'success');
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSavingCalendly(false);
    }
  }

  const nav: { id: Section; label: string; icon: IconName }[] = [
    { id: 'general', label: 'General', icon: 'settings-2' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
    { id: 'team', label: 'Team & roles', icon: 'users' },
    { id: 'integrations', label: 'Integrations', icon: 'plug' },
    { id: 'billing', label: 'Billing', icon: 'credit-card' },
  ];

  const integrations: { name: string; desc: string; icon: IconName; on: boolean }[] = [
    { name: 'Slack', desc: 'Pipeline alerts to your channels', icon: 'message-square', on: false },
    { name: 'Google Calendar', desc: 'Sync interview scheduling', icon: 'calendar', on: false },
    { name: 'Gmail', desc: 'Send candidate emails from Nearwork', icon: 'mail', on: false },
    { name: 'Stripe', desc: 'Client billing & invoices', icon: 'credit-card', on: true },
  ];

  const field: React.CSSProperties = { font: 'inherit', fontSize: 13.5, padding: '9px 14px', borderRadius: 9, border: `1px solid ${NW.gray200}`, width: 280, outline: 'none', background: NW.white };

  return (
    <MainLayout>
      <div>
        <PageHeader overline="Account" title="Settings" subtitle="Manage your workspace, notifications, and integrations." />
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
          <Card pad={10}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {nav.map((n) => {
                const on = n.id === section;
                return (
                  <button key={n.id} onClick={() => setSection(n.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 9, border: 'none', font: 'inherit', fontSize: 13.5, fontWeight: on ? 600 : 500, color: on ? NW.black : NW.gray600, background: on ? NW.gray50 : 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                    <Icon name={n.icon} size={16} color={on ? NW.teal600 : NW.gray500} /> {n.label}
                  </button>
                );
              })}
            </div>
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {section === 'general' ? (
              <>
                <Card>
                  <CardHead icon="tag" title="Version" sub="MAJOR.MINOR.PATCH — Major = rebuild · Minor = features · Patch = fixes" />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px solid ${NW.gray200}`, background: NW.gray50, borderRadius: 9, padding: '8px 12px' }}>
                      <Icon name="tag" size={15} color={NW.teal600} /><span style={{ fontSize: 14, fontWeight: 700, color: NW.black }}>{APP_VERSION}</span>
                    </span>
                    <Link href="/changelog" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: NW.teal600 }}><Icon name="file-text" size={14} color={NW.teal600} />View changelog</Link>
                  </div>
                </Card>
                <Card>
                  <CardHead icon="link" title="Your Calendly link" sub="Shown to candidates you manage when scheduling interviews." />
                  <div style={{ display: 'flex', gap: 12 }}>
                    <input type="url" value={calendlyLink} onChange={(e) => setCalendlyLink(e.target.value)} placeholder="https://calendly.com/your-name" style={{ ...field, flex: 1, width: 'auto' }} />
                    <Button variant="primary" size="md" onClick={saveCalendly} disabled={savingCalendly}>{savingCalendly ? 'Saving…' : 'Save'}</Button>
                  </div>
                  {calendlyLink && <a href={calendlyLink} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: NW.teal600, marginTop: 10 }}><Icon name="external-link" size={13} color={NW.teal600} />Preview your Calendly</a>}
                </Card>
                <Card>
                  <CardHead icon="sliders-horizontal" title="Preferences" />
                  <ToggleRow title="Show candidate scores" desc="Display assessment scores across the ATS" defaultOn />
                  <ToggleRow title="Auto-assign sourced candidates" desc="Route new sourced candidates by role" defaultOn />
                  <ToggleRow title="Compact tables" desc="Denser rows in candidate and opening lists" />
                </Card>
              </>
            ) : section === 'notifications' ? (
              <Card>
                <CardHead icon="bell" title="Notifications" sub="In-app only for now — email notifications coming in a future update." />
                <ToggleRow title="New candidate added to pipeline" desc="When a candidate is added to a pipeline you manage" defaultOn />
                <ToggleRow title="Stage change" desc="When a candidate advances or moves stage" defaultOn />
                <ToggleRow title="Assessment completed" desc="When a candidate finishes their assessment" defaultOn />
                <ToggleRow title="Opening approval required" desc="When an opening is submitted for review" defaultOn />
                <ToggleRow title="Weekly summary email" desc="Monday digest of pipeline health" />
              </Card>
            ) : section === 'team' ? (
              <Card>
                <CardHead icon="users" title="Team & roles" sub="Admin is invite-only — even @nearwork.co addresses need an invitation." />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px', borderRadius: 12, background: NW.gray50 }}>
                  <div style={{ fontSize: 13, color: NW.gray600 }}>Manage members, invites and access levels on the Team page.</div>
                  <Link href="/users"><Button variant="secondary" size="sm" iconRight="arrow-right">Open Team</Button></Link>
                </div>
              </Card>
            ) : section === 'integrations' ? (
              <Card>
                <CardHead icon="plug" title="Integrations" sub="Connect Nearwork to the tools your team uses." />
                {integrations.map((it, i) => (
                  <div key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 0', borderTop: i ? `1px solid ${NW.gray100}` : 'none' }}>
                    <span style={{ width: 38, height: 38, borderRadius: 9, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={it.icon} size={17} color={NW.gray600} /></span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{it.name}</div>
                      <div style={{ fontSize: 12.5, color: NW.gray500 }}>{it.desc}</div>
                    </div>
                    {it.on ? <Chip variant="success" size="sm" icon="check">Connected</Chip> : <Button variant="secondary" size="sm">Connect</Button>}
                  </div>
                ))}
                <div style={{ fontSize: 11.5, color: NW.gray400, marginTop: 14 }}>Integration management is illustrative — wiring lands in a later pass.</div>
              </Card>
            ) : (
              <Card>
                <CardHead icon="credit-card" title="Billing" sub="Plan and payment." />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: NW.teal50, border: `1px solid ${NW.teal500}25`, borderRadius: 12, padding: 18 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: NW.teal700 }}>Nearwork · Internal</div>
                    <div style={{ fontSize: 13, color: NW.gray600, marginTop: 3 }}>Full workspace · unlimited seats · all modules</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, color: NW.gray500 }}>Client billing runs through Stripe</div>
                    <Link href="/organizations"><Button variant="ghost" size="sm" iconRight="arrow-right" style={{ marginTop: 4 }}>View accounts</Button></Link>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
