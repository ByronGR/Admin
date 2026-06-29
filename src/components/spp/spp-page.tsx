'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db, collection, getDocs } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { fmtCurrency } from '@/lib/utils';
import type { Organization, Placement, Opening } from '@/lib/types';
import { NW, MONO, Icon, CompanyTile } from '@/components/nw/primitives';
import { PageHeader, Card, SegTabs, Table, Th, Td, TableRow, StatusBadge } from '@/components/nw/shell-ui';
import { colorFor, placementsForOrg } from '@/components/teams/teams-page';

function SppStat({ label, value, accent }: { label: string; value: React.ReactNode; accent: string }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.03)', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ width: 4, height: 34, borderRadius: 2, background: accent }} />
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: NW.gray500 }}>{label}</div>
        <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: NW.black, marginTop: 3, lineHeight: 1 }}>{value}</div>
      </div>
    </div>
  );
}

function TierChip({ tier }: { tier: 'Scale' | 'Growth' }) {
  const scale = tier === 'Scale';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: scale ? NW.violet500 : NW.teal700, background: scale ? NW.violet50 : NW.teal50, border: `1px solid ${(scale ? NW.violet500 : NW.teal600)}22`, borderRadius: 999, padding: '3px 10px' }}>
      <Icon name={scale ? 'gem' : 'trending-up'} size={11} color={scale ? NW.violet500 : NW.teal600} /> {tier}
    </span>
  );
}

type Tab = 'all' | 'active' | 'onboarding';

export default function SppPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [orgRes, placeRes, openRes] = await Promise.allSettled([
      getDocs(collection(db, 'organizations')),
      getDocs(collection(db, 'placements')),
      getDocs(collection(db, 'openings')),
    ]);
    if (orgRes.status === 'fulfilled') setOrgs(orgRes.value.docs.map((d) => ({ ...d.data(), id: d.id } as Organization)));
    else showToast('Failed to load partners', 'error');
    if (placeRes.status === 'fulfilled') setPlacements(placeRes.value.docs.map((d) => ({ id: d.id, ...d.data() } as Placement)));
    if (openRes.status === 'fulfilled') setOpenings(openRes.value.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)));
    setLoading(false);
  }

  const partners = orgs.filter((o) => o.isStrategicPartner);

  function statsFor(partner: Organization) {
    const children = orgs.filter((o) => o.parentOrgId === partner.id);
    const family = [partner, ...children];
    const hires = family.reduce((n, o) => n + placementsForOrg(placements, o).filter((p) => (p.status ?? 'active') !== 'ended').length, 0);
    const familyIds = new Set(family.map((o) => o.id));
    const familyNames = new Set(family.map((o) => o.name));
    const openRoles = openings.filter((o) => (o.orgId && familyIds.has(o.orgId)) || (o.orgName && familyNames.has(o.orgName))).filter((o) => o.status !== 'filled' && o.status !== 'cancelled').length;
    const spend = partner.totalSpend ?? 0;
    return { clients: children.length, hires, openRoles, spend, tier: (children.length >= 3 ? 'Scale' : 'Growth') as 'Scale' | 'Growth' };
  }

  const rows = partners
    .map((p) => ({ p, s: statsFor(p) }))
    .filter(({ p }) => (tab === 'all' ? true : (p.status ?? 'active') === tab));

  const totals = partners.reduce(
    (acc, p) => { const s = statsFor(p); acc.clients += s.clients; acc.hires += s.hires; acc.openRoles += s.openRoles; acc.spend += s.spend; return acc; },
    { clients: 0, hires: 0, openRoles: 0, spend: 0 },
  );

  return (
    <MainLayout>
      <div>
        <PageHeader
          overline="Strategic Partner Program"
          title="Partners"
          subtitle="Agencies and consultancies reselling Nearwork to their own end-clients."
        />

        <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
          <SppStat label="Partners" value={partners.length} accent={NW.teal500} />
          <SppStat label="End-clients" value={totals.clients} accent={NW.violet500} />
          <SppStat label="Active hires" value={totals.hires} accent={NW.blue500} />
          <SppStat label="Open roles" value={totals.openRoles} accent={NW.rose500} />
          <SppStat label="Program spend" value={fmtCurrency(totals.spend, 'USD')} accent={NW.black} />
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center"><Spinner /></div>
        ) : (
          <Card pad={0}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: `1px solid ${NW.gray100}`, gap: 12, flexWrap: 'wrap' }}>
              <SegTabs active={tab} onChange={setTab} tabs={[
                { id: 'all', label: 'All', count: partners.length },
                { id: 'active', label: 'Active' },
                { id: 'onboarding', label: 'Onboarding' },
              ]} />
            </div>
            <div style={{ padding: '6px 6px 8px' }}>
              <Table>
                <thead>
                  <tr>
                    <Th style={{ paddingLeft: 16 }}>Partner</Th><Th>Tier</Th>
                    <Th align="right">End-clients</Th><Th align="right">Hires</Th><Th align="right">Open roles</Th><Th align="right">Spend</Th>
                    <Th>Owner</Th><Th align="right" style={{ paddingRight: 16 }}>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <Td style={{ paddingLeft: 16 }}><span style={{ color: NW.gray400 }}>No strategic partners yet — mark an organization as a Strategic Partner to list it here.</span></Td>
                      <Td /><Td /><Td /><Td /><Td /><Td /><Td />
                    </tr>
                  ) : (
                    rows.map(({ p, s }) => (
                      <TableRow key={p.id} onClick={() => router.push(`/organizations?id=${p.id}`)}>
                        <Td style={{ paddingLeft: 16 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 11 }}>
                            <CompanyTile logo={(p.name[0] || '?').toUpperCase()} color={colorFor(p.name)} size={32} radius={8} />
                            <span style={{ lineHeight: 1.25 }}>
                              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: NW.black }}>{p.name}</span>
                              <span style={{ display: 'block', fontSize: 12, color: NW.gray500 }}>{p.createdAt ? `Since ${new Date((p.createdAt as { toDate?: () => Date }).toDate?.() ?? Date.now()).getFullYear()}` : 'Strategic partner'}</span>
                            </span>
                          </span>
                        </Td>
                        <Td><TierChip tier={s.tier} /></Td>
                        <Td align="right" style={{ fontFamily: MONO }}>{s.clients}</Td>
                        <Td align="right" style={{ fontFamily: MONO }}>{s.hires}</Td>
                        <Td align="right" style={{ fontFamily: MONO }}>{s.openRoles}</Td>
                        <Td align="right" style={{ fontFamily: MONO, fontWeight: 600, color: NW.black }}>{s.spend ? fmtCurrency(s.spend, 'USD') : '—'}</Td>
                        <Td><span style={{ fontSize: 13, color: NW.gray600 }}>{p.accountManager || '—'}</span></Td>
                        <Td align="right" style={{ paddingRight: 16 }}><StatusBadge status={(p.status as string) ?? 'active'} /></Td>
                      </TableRow>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
