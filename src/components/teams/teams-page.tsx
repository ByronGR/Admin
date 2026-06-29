'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { db, collection, getDocs, addDoc, serverTimestamp } from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { sortByTimestamp, initials } from '@/lib/utils';
import type { Placement, Organization } from '@/lib/types';
import { NW, MONO, Icon, Avatar, CompanyTile, Button } from '@/components/nw/primitives';
import { PageHeader, Card } from '@/components/nw/shell-ui';

export interface ManagedTeam {
  id: string;
  orgId: string;
  orgName?: string;
  name: string;
  focus?: string;
  health?: 'on-track' | 'attention';
  leadId?: string;
  memberIds?: string[];
  createdAt?: unknown;
}

const AVA_PALETTE = ['#16A085', '#E74C7C', '#AF7AC5', '#3B82F6', '#12866E', '#EAB308', '#EC5290'];
export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVA_PALETTE[h % AVA_PALETTE.length];
}

export function TeamHealth({ health, big }: { health?: string; big?: boolean }) {
  const ok = health !== 'attention';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: ok ? NW.teal700 : '#A16207', background: ok ? NW.teal50 : NW.yellow50, border: `1px solid ${ok ? NW.teal500 + '22' : '#CA8A0422'}`, borderRadius: 999, padding: big ? '4px 11px' : '3px 10px' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? NW.teal500 : '#CA8A04' }} />{ok ? 'On track' : big ? 'Needs attention' : 'Attention'}
    </span>
  );
}

// A placement belongs to an org if either its id or name matches.
export function placementsForOrg(placements: Placement[], org: { id: string; name?: string }): Placement[] {
  return placements.filter((p) => (p.orgId && p.orgId === org.id) || (p.orgName && org.name && p.orgName === org.name));
}

export default function TeamsPage() {
  const { showToast } = useToast();
  const router = useRouter();

  const [teams, setTeams] = useState<ManagedTeam[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ orgId: '', name: '', focus: '', health: 'on-track' as 'on-track' | 'attention', leadId: '', memberIds: [] as string[] });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [teamRes, placeRes, orgRes] = await Promise.allSettled([
      getDocs(collection(db, 'managedTeams')),
      getDocs(collection(db, 'placements')),
      getDocs(collection(db, 'organizations')),
    ]);
    if (teamRes.status === 'fulfilled') {
      setTeams(sortByTimestamp(teamRes.value.docs.map((d) => ({ id: d.id, ...d.data() } as ManagedTeam)), 'createdAt'));
    } else {
      showToast('Failed to load managed teams', 'error');
    }
    if (placeRes.status === 'fulfilled') setPlacements(placeRes.value.docs.map((d) => ({ id: d.id, ...d.data() } as Placement)));
    if (orgRes.status === 'fulfilled') setOrgs(orgRes.value.docs.map((d) => ({ ...d.data(), id: d.id } as Organization)));
    setLoading(false);
  }

  const placeById = useMemo(() => {
    const m: Record<string, Placement> = {};
    placements.forEach((p) => { m[p.id] = p; if (p.candidateId) m[p.candidateId] = p; });
    return m;
  }, [placements]);

  const orgsWithTeams = new Set(teams.map((t) => t.orgId)).size;
  const totalMembers = teams.reduce((n, t) => n + (t.memberIds?.length ?? 0), 0);
  const stats: [string, number][] = [['Managed teams', teams.length], ['Client orgs', orgsWithTeams], ['People on teams', totalMembers]];

  // Modal: hires available for the selected org.
  const selectedOrg = orgs.find((o) => o.id === form.orgId);
  const orgHires = selectedOrg ? placementsForOrg(placements, selectedOrg) : [];

  function openModal() {
    const firstOrg = orgs[0]?.id ?? '';
    setForm({ orgId: firstOrg, name: '', focus: '', health: 'on-track', leadId: '', memberIds: [] });
    setAdding(true);
  }

  function toggleMember(id: string) {
    setForm((f) => ({ ...f, memberIds: f.memberIds.includes(id) ? f.memberIds.filter((x) => x !== id) : [...f.memberIds, id] }));
  }

  async function saveTeam() {
    if (!form.name.trim() || !form.orgId) { showToast('Pick an organization and name the team', 'error'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'managedTeams'), {
        orgId: form.orgId,
        orgName: selectedOrg?.name ?? '',
        name: form.name.trim(),
        focus: form.focus.trim(),
        health: form.health,
        leadId: form.leadId || (form.memberIds[0] ?? ''),
        memberIds: form.memberIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast('Managed team created', 'success');
      setAdding(false);
      load();
    } catch {
      showToast('Failed to create team', 'error');
    } finally {
      setSaving(false);
    }
  }

  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: `1px solid ${NW.gray200}`, borderRadius: 9, padding: '9px 11px', font: 'inherit', fontSize: 13.5, color: NW.black, outline: 'none', background: NW.white };
  const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: NW.gray500, marginBottom: 6, display: 'block' };

  return (
    <MainLayout>
      <div>
        <PageHeader
          overline="Staffing"
          title="Managed teams"
          subtitle="Pods Nearwork staffs and runs for clients — group hires, set a lead, track health."
          actions={<Button variant="primary" size="md" icon="plus" onClick={openModal}>Add managed team</Button>}
        />

        <div style={{ display: 'flex', gap: 28, marginBottom: 22, padding: '4px 2px', flexWrap: 'wrap' }}>
          {stats.map(([l, v]) => (
            <div key={l}>
              <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: NW.black }}>{v}</div>
              <div style={{ fontSize: 12, color: NW.gray500, marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center"><Spinner /></div>
        ) : teams.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
            {teams.map((t) => {
              const orgName = t.orgName || orgs.find((o) => o.id === t.orgId)?.name || '—';
              const members = (t.memberIds ?? []).map((id) => placeById[id]).filter(Boolean) as Placement[];
              const lead = t.leadId ? placeById[t.leadId] : undefined;
              return (
                <Card key={t.id} hover onClick={() => router.push(`/teams/${t.id}`)}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <CompanyTile logo={(orgName[0] || '?').toUpperCase()} color={colorFor(orgName)} size={40} radius={10} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: NW.black, letterSpacing: '-0.01em' }}>{t.name}</div>
                        <div style={{ fontSize: 12, color: NW.gray500, marginTop: 1 }}>{orgName} · {t.focus || 'General'}</div>
                      </div>
                    </div>
                    <TeamHealth health={t.health} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 13, borderTop: `1px solid ${NW.gray100}` }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      {members.slice(0, 5).map((h, i) => (
                        <span key={h.id} style={{ marginLeft: i ? -8 : 0, border: `2px solid ${NW.white}`, borderRadius: '50%' }}>
                          <Avatar initials={initials(h.candidateName || '') || '—'} size={30} bg={colorFor(h.candidateId || h.id)} />
                        </span>
                      ))}
                      {members.length > 5 && <span style={{ marginLeft: -8, width: 30, height: 30, borderRadius: '50%', background: NW.gray100, border: `2px solid ${NW.white}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: NW.gray600 }}>+{members.length - 5}</span>}
                      <span style={{ fontSize: 12, color: NW.gray500, marginLeft: 10 }}>{members.length} {members.length === 1 ? 'member' : 'members'}</span>
                    </div>
                    {lead && <span style={{ fontSize: 11.5, color: NW.gray500 }}>Lead · <span style={{ color: NW.gray700, fontWeight: 600 }}>{(lead.candidateName || '').split(' ')[0]}</span></span>}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px 16px' }}>
              <Icon name="users-round" size={26} color={NW.gray300} />
              <div style={{ fontSize: 14, fontWeight: 600, color: NW.gray600, marginTop: 10 }}>No managed teams yet</div>
              <div style={{ fontSize: 12.5, color: NW.gray400, marginTop: 3 }}>Create a pod and group a client&apos;s hires under it.</div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                <Button variant="secondary" size="sm" icon="plus" onClick={openModal}>Add managed team</Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Add managed team modal */}
      <Modal open={adding} onClose={() => !saving && setAdding(false)} title="Add managed team" size="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl}>Organization</label>
            <select style={field} value={form.orgId} onChange={(e) => setForm((f) => ({ ...f, orgId: e.target.value, leadId: '', memberIds: [] }))}>
              {orgs.length === 0 && <option value="">No organizations</option>}
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Team name</label>
            <input style={field} value={form.name} placeholder="e.g. Platform Pod" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Focus</label><input style={field} value={form.focus} placeholder="What they work on" onChange={(e) => setForm((f) => ({ ...f, focus: e.target.value }))} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Health</label><select style={field} value={form.health} onChange={(e) => setForm((f) => ({ ...f, health: e.target.value as 'on-track' | 'attention' }))}><option value="on-track">On track</option><option value="attention">Attention</option></select></div>
          </div>
          <div>
            <label style={lbl}>Team lead</label>
            <select style={field} value={form.leadId} onChange={(e) => setForm((f) => ({ ...f, leadId: e.target.value }))}>
              {orgHires.length === 0 && <option value="">No hires for this org</option>}
              {orgHires.map((h) => <option key={h.id} value={h.id}>{h.candidateName}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Members</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflow: 'auto' }}>
              {orgHires.map((h) => {
                const on = form.memberIds.includes(h.id);
                return (
                  <div key={h.id} onClick={() => toggleMember(h.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 10px', borderRadius: 10, border: `1px solid ${on ? NW.teal500 + '55' : NW.gray100}`, background: on ? NW.teal50 : NW.white, cursor: 'pointer' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${on ? NW.teal500 : NW.gray300}`, background: on ? NW.teal500 : NW.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on && <Icon name="check" size={12} color={NW.white} />}</span>
                    <Avatar initials={initials(h.candidateName || '') || '—'} size={28} bg={colorFor(h.candidateId || h.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: NW.black }}>{h.candidateName}</div>
                      <div style={{ fontSize: 11, color: NW.gray500 }}>{h.openingTitle || '—'}</div>
                    </div>
                  </div>
                );
              })}
              {orgHires.length === 0 && <div style={{ fontSize: 12.5, color: NW.gray400, padding: '8px' }}>No hires for this org yet — add placements in Hired first.</div>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
          <Button variant="primary" size="sm" icon="check" disabled={saving || !form.name.trim() || !form.orgId} onClick={saveTeam}>{saving ? 'Creating…' : 'Create team'}</Button>
        </div>
      </Modal>
    </MainLayout>
  );
}
