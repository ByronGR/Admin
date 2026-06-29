'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { db, collection, getDocs, doc, updateDoc, deleteDoc, serverTimestamp } from '@/lib/firebase';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { fmtCurrency, initials } from '@/lib/utils';
import type { Placement, Organization } from '@/lib/types';
import { NW, MONO, Icon, Avatar, CompanyTile, Button } from '@/components/nw/primitives';
import { Card, CardHead, BackBar, Table, Th, Td, TableRow, StatusBadge } from '@/components/nw/shell-ui';
import { type ManagedTeam, TeamHealth, colorFor, placementsForOrg } from './teams-page';
import { type IconName } from 'lucide-react/dynamic';

function Fact({ icon, label, value, sub, accent }: { icon: IconName; label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 150, padding: '16px 18px', borderRight: `1px solid ${NW.gray100}` }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: NW.gray400, marginBottom: 7 }}>
        <Icon name={icon} size={13} color={NW.gray400} />{label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: accent ?? NW.black }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: NW.gray400, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function TeamDetail({ team, onRefresh }: { team: ManagedTeam; onRefresh: () => Promise<void> }) {
  const { showToast } = useToast();
  const router = useRouter();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState({ name: team.name, focus: team.focus ?? '', health: (team.health ?? 'on-track') as 'on-track' | 'attention', leadId: team.leadId ?? '', memberIds: team.memberIds ?? [] });

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [team.id]);

  async function load() {
    setLoading(true);
    const [placeRes, orgRes] = await Promise.allSettled([
      getDocs(collection(db, 'placements')),
      getDocs(collection(db, 'organizations')),
    ]);
    if (placeRes.status === 'fulfilled') setPlacements(placeRes.value.docs.map((d) => ({ id: d.id, ...d.data() } as Placement)));
    if (orgRes.status === 'fulfilled') setOrgs(orgRes.value.docs.map((d) => ({ ...d.data(), id: d.id } as Organization)));
    setLoading(false);
  }

  const placeById = useMemo(() => {
    const m: Record<string, Placement> = {};
    placements.forEach((p) => { m[p.id] = p; if (p.candidateId) m[p.candidateId] = p; });
    return m;
  }, [placements]);

  const org = orgs.find((o) => o.id === team.orgId);
  const orgName = team.orgName || org?.name || '—';
  const members = (team.memberIds ?? []).map((id) => placeById[id]).filter(Boolean) as Placement[];
  const lead = team.leadId ? placeById[team.leadId] : undefined;
  const active = members.filter((m) => (m.status ?? 'active') !== 'ended').length;
  const salaried = members.filter((m) => (m.salaryAmount ?? 0) > 0);
  const avgSalary = salaried.length ? Math.round(salaried.reduce((s, m) => s + (m.salaryAmount ?? 0), 0) / salaried.length) : 0;
  const ok = (team.health ?? 'on-track') !== 'attention';

  const orgHires = org ? placementsForOrg(placements, org) : members;

  async function saveEdit() {
    if (!form.name.trim()) { showToast('Team name is required', 'error'); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'managedTeams', team.id), {
        name: form.name.trim(), focus: form.focus.trim(), health: form.health,
        leadId: form.leadId, memberIds: form.memberIds, updatedAt: serverTimestamp(),
      });
      showToast('Team updated', 'success');
      setEditing(false);
      await onRefresh();
    } catch {
      showToast('Failed to save team', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam() {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'managedTeams', team.id));
      showToast('Managed team deleted', 'success');
      router.push('/teams');
    } catch {
      showToast('Failed to delete team', 'error');
      setDeleting(false);
    }
  }

  function toggleMember(id: string) {
    setForm((f) => ({ ...f, memberIds: f.memberIds.includes(id) ? f.memberIds.filter((x) => x !== id) : [...f.memberIds, id] }));
  }

  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: `1px solid ${NW.gray200}`, borderRadius: 9, padding: '9px 11px', font: 'inherit', fontSize: 13.5, color: NW.black, outline: 'none', background: NW.white };
  const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: NW.gray500, marginBottom: 6, display: 'block' };

  return (
    <div>
      <BackBar label="Managed teams" href="/teams" />

      {/* Header */}
      <Card pad={20} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 15, minWidth: 0 }}>
            <CompanyTile logo={(orgName[0] || '?').toUpperCase()} color={colorFor(orgName)} size={50} radius={13} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: NW.black }}>{team.name}</h1>
                <TeamHealth health={team.health} big />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, fontSize: 13, color: NW.gray600, flexWrap: 'wrap' }}>
                <span>{team.focus || 'General'}</span>
                <span style={{ color: NW.gray300 }}>·</span>
                {org ? (
                  <span onClick={() => router.push(`/organizations?id=${org.id}`)} style={{ cursor: 'pointer', fontWeight: 600, color: NW.teal700 }}>{orgName}</span>
                ) : <span style={{ fontWeight: 600 }}>{orgName}</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <HoldToDelete onConfirm={deleteTeam} busy={deleting} size="md" label="Hold to delete" title="Delete this team" />
            <Button variant="primary" size="md" icon="pencil" onClick={() => { setForm({ name: team.name, focus: team.focus ?? '', health: (team.health ?? 'on-track'), leadId: team.leadId ?? '', memberIds: team.memberIds ?? [] }); setEditing(true); }}>Edit team</Button>
          </div>
        </div>
      </Card>

      {/* Stat strip */}
      <Card pad={0} style={{ marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <Fact icon="users-round" label="Members" value={members.length} sub={`${active} active`} />
          <Fact icon="crown" label="Team lead" value={lead ? (lead.candidateName || '').split(' ')[0] : '—'} sub={lead?.openingTitle ?? undefined} />
          <Fact icon={ok ? 'trending-up' : 'alert-triangle'} label="Health" value={ok ? 'On track' : 'Attention'} accent={ok ? NW.teal600 : '#A16207'} sub="overall" />
          <Fact icon="wallet" label="Avg. salary" value={avgSalary ? <span style={{ fontFamily: MONO }}>{fmtCurrency(avgSalary, 'USD')}</span> : '—'} sub="per person / mo" />
        </div>
      </Card>

      {/* Members */}
      <Card pad={0}>
        <div style={{ padding: '18px 20px 6px' }}><CardHead icon="users-round" title="Team members" sub={`${members.length} ${members.length === 1 ? 'person' : 'people'} · click to open a hire`} /></div>
        <div style={{ padding: '0 8px 10px' }}>
          {loading ? (
            <div style={{ padding: 30, display: 'flex', justifyContent: 'center' }}><Spinner /></div>
          ) : (
            <Table>
              <thead><tr><Th style={{ paddingLeft: 14 }}>Member</Th><Th>Focus</Th><Th>Role</Th><Th align="right" style={{ paddingRight: 14 }}>Status</Th></tr></thead>
              <tbody>
                {members.map((h) => {
                  const isLead = lead && (h.id === lead.id || h.candidateId === lead.candidateId);
                  const statusKey = h.status === 'ended' ? 'ended' : h.status === 'on_hold' ? 'paused' : 'active';
                  return (
                    <TableRow key={h.id} onClick={() => router.push(`/hired/${h.id}`)}>
                      <Td style={{ paddingLeft: 14 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 11 }}>
                          <Avatar initials={initials(h.candidateName || '') || '—'} size={34} bg={colorFor(h.candidateId || h.id)} />
                          <span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              <span style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{h.candidateName}</span>
                              {isLead && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#A16207', background: NW.yellow50, borderRadius: 5, padding: '1px 7px' }}><Icon name="crown" size={10} color="#CA8A04" />Lead</span>}
                            </span>
                            <span style={{ fontSize: 11.5, color: NW.gray500 }}>{h.salaryAmount ? `${fmtCurrency(h.salaryAmount, h.salaryCurrency)}/mo` : '—'}</span>
                          </span>
                        </span>
                      </Td>
                      <Td><span style={{ fontSize: 13, color: NW.gray700 }}>{h.pipelineCode || h.openingTitle || '—'}</span></Td>
                      <Td><span style={{ fontSize: 13, color: NW.gray600 }}>{h.openingTitle || '—'}</span></Td>
                      <Td align="right" style={{ paddingRight: 14 }}><StatusBadge status={statusKey} /></Td>
                    </TableRow>
                  );
                })}
                {members.length === 0 && <tr><Td style={{ paddingLeft: 14 }}><span style={{ fontSize: 13, color: NW.gray400 }}>No members yet — use Edit team to add hires.</span></Td><Td /><Td /><Td /></tr>}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      {/* Edit modal */}
      <Modal open={editing} onClose={() => !saving && setEditing(false)} title="Edit managed team" size="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label style={lbl}>Team name</label><input style={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Focus</label><input style={field} value={form.focus} placeholder="What they work on" onChange={(e) => setForm((f) => ({ ...f, focus: e.target.value }))} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Health</label><select style={field} value={form.health} onChange={(e) => setForm((f) => ({ ...f, health: e.target.value as 'on-track' | 'attention' }))}><option value="on-track">On track</option><option value="attention">Attention</option></select></div>
          </div>
          <div>
            <label style={lbl}>Team lead</label>
            <select style={field} value={form.leadId} onChange={(e) => setForm((f) => ({ ...f, leadId: e.target.value }))}>
              <option value="">No lead</option>
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
              {orgHires.length === 0 && <div style={{ fontSize: 12.5, color: NW.gray400, padding: '8px' }}>No hires for this org yet.</div>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          <Button variant="primary" size="sm" icon="check" disabled={saving || !form.name.trim()} onClick={saveEdit}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </Modal>
    </div>
  );
}
