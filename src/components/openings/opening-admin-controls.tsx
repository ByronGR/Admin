'use client';

// Admin-only controls on an opening:
//   1. Move the opening to another organization — reassigns ownership WITHOUT
//      touching the document id, its public link, or any content. The opening
//      keeps the same jobs.nearwork.co URL (the board looks it up by id and only
//      filters on `published`), so a role already shared on social media just
//      becomes visible to a different client. orgId/orgName are synced across the
//      opening, its pipeline and its kick-off brief so the client sees the whole
//      thing in their portal.
//   2. Record an offline brief approval — when the client approved the brief
//      outside the app, mark it approved (and auto-publish) without waiting for a
//      redundant click. Calls /api/kickoff with onBehalf, which stamps the audit
//      history as approved-offline.

import { useState } from 'react';
import { auth, db, doc, updateDoc, serverTimestamp } from '@/lib/firebase';
import { NW, Icon, Button } from '@/components/nw/primitives';
import type { Opening, Organization } from '@/lib/types';

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: NW.gray500, marginBottom: 7,
};
const select: React.CSSProperties = {
  width: '100%', fontSize: 13.5, padding: '9px 11px', borderRadius: 9,
  border: `1px solid ${NW.gray200}`, background: NW.white, color: NW.black, outline: 'none',
};

export function OpeningAdminControls({
  opening, orgs, briefStatus, onChanged, showToast,
}: {
  opening: Opening;
  orgs: Organization[];
  briefStatus: string | null;
  onChanged: () => void | Promise<void>;
  showToast: (msg: string, kind: 'success' | 'error') => void;
}) {
  const code = opening.code ?? opening.id;
  const currentOrg = orgs.find((o) => o.id === opening.orgId);
  const [targetOrgId, setTargetOrgId] = useState(opening.orgId ?? '');
  const [moving, setMoving] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [ptSaving, setPtSaving] = useState(false);
  const [pipelineType, setPipelineType] = useState<'full' | 'sourcing'>(
    opening.pipelineType === 'sourcing' ? 'sourcing' : 'full'
  );

  const targetOrg = orgs.find((o) => o.id === targetOrgId);
  const orgChanged = targetOrgId && targetOrgId !== opening.orgId;
  const ptChanged = pipelineType !== (opening.pipelineType ?? 'full');
  const briefApproved = briefStatus === 'approved';

  // ── Engagement type: full recruitment vs sourcing only ────────────────────
  // Writes pipelineType to BOTH the opening and its pipeline doc (the board reads
  // the pipeline doc). Both allow admin writes per the Firestore rules.
  async function savePipelineType() {
    setPtSaving(true);
    try {
      await Promise.all([
        updateDoc(doc(db, 'openings', opening.id), { pipelineType, updatedAt: serverTimestamp() }),
        updateDoc(doc(db, 'pipelines', code), { pipelineType, updatedAt: serverTimestamp() }).catch(() => {}),
      ]);
      showToast(`Engagement set to ${pipelineType === 'sourcing' ? 'Sourcing only' : 'Full recruitment'}`, 'success');
      await onChanged();
    } catch {
      showToast('Failed to update engagement type', 'error');
    } finally {
      setPtSaving(false);
    }
  }

  // ── 1. Reassign organization ──────────────────────────────────────────────
  // Goes through the server (Admin SDK): the kick-off brief can't be written from
  // the client, and its org must move too or the new client can't see the brief.
  async function moveOrg() {
    if (!orgChanged || !targetOrg) return;
    const user = auth.currentUser;
    if (!user) { showToast('Please sign in again', 'error'); return; }
    setMoving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/move-opening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ openingId: opening.id, code, orgId: targetOrg.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');
      showToast(`Opening moved to ${targetOrg.name} — link and ID unchanged`, 'success');
      setConfirmMove(false);
      await onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to move the opening', 'error');
    } finally {
      setMoving(false);
    }
  }

  // ── 2. Record offline brief approval ──────────────────────────────────────
  async function approveOffline() {
    const user = auth.currentUser;
    if (!user) { showToast('Please sign in again', 'error'); return; }
    setApproving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/kickoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'approve', code, onBehalf: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');
      showToast('Brief marked approved (client approved offline) — role is live', 'success');
      setConfirmApprove(false);
      await onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to record approval', 'error');
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="rounded-[16px] border border-[#EBEBEB] bg-white p-6" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: NW.gray50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="shield" size={17} color={NW.gray600} />
        </span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: NW.black }}>Admin controls</div>
          <div style={{ fontSize: 12, color: NW.gray500 }}>Ownership and approval — internal only, never shown to clients.</div>
        </div>
      </div>

      {/* ── Engagement type ── */}
      <div>
        <span style={label}>Engagement type</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([
            { v: 'full', t: 'Full recruitment', d: 'We run the whole pipeline.' },
            { v: 'sourcing', t: 'Sourcing only', d: 'We source & submit; client runs the rest.' },
          ] as const).map((opt) => {
            const on = pipelineType === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => setPipelineType(opt.v)}
                style={{
                  textAlign: 'left', padding: '11px 13px', borderRadius: 10, cursor: 'pointer',
                  border: `1.5px solid ${on ? NW.teal500 : NW.gray200}`,
                  background: on ? NW.teal50 : NW.white,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: on ? NW.teal700 : NW.black }}>{opt.t}</div>
                <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 2, lineHeight: 1.4 }}>{opt.d}</div>
              </button>
            );
          })}
        </div>
        {ptChanged && (
          <div style={{ marginTop: 10 }}>
            <Button variant="primary" size="md" onClick={savePipelineType} disabled={ptSaving}>
              {ptSaving ? 'Saving…' : `Switch to ${pipelineType === 'sourcing' ? 'Sourcing only' : 'Full recruitment'}`}
            </Button>
            <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 7, lineHeight: 1.45 }}>
              Changes which stages this role&rsquo;s pipeline uses. Existing candidates keep their stage; move them into the new stages as needed.
            </div>
          </div>
        )}
      </div>

      {/* ── Move to organization ── */}
      <div>
        <span style={label}>Organization</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={{ ...select, flex: 1, minWidth: 200 }} value={targetOrgId} onChange={(e) => { setTargetOrgId(e.target.value); setConfirmMove(false); }}>
            {!opening.orgId && <option value="">— Unassigned —</option>}
            {orgs.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')).map((o) => (
              <option key={o.id} value={o.id}>{o.name}{o.internal ? ' (internal)' : ''}</option>
            ))}
          </select>
          {orgChanged && !confirmMove && (
            <Button variant="secondary" size="md" onClick={() => setConfirmMove(true)}>Move…</Button>
          )}
        </div>
        <div style={{ fontSize: 12, color: NW.gray500, marginTop: 8, lineHeight: 1.5 }}>
          Currently <strong>{currentOrg?.name ?? opening.orgName ?? 'Unassigned'}</strong>. Moving keeps the
          same opening ID (<code style={{ background: NW.gray50, padding: '1px 5px', borderRadius: 4 }}>{code}</code>),
          the same public link, and all content — it only changes which client sees it in their portal.
        </div>

        {orgChanged && confirmMove && targetOrg && (
          <div style={{ marginTop: 12, background: NW.gray50, border: `1px solid ${NW.gray200}`, borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 13, color: NW.black, lineHeight: 1.55 }}>
              Move this opening from <strong>{currentOrg?.name ?? opening.orgName ?? 'Unassigned'}</strong> to <strong>{targetOrg.name}</strong>?
              The link and ID stay the same; {targetOrg.name} will see it (and its pipeline) in their portal.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button variant="primary" size="sm" onClick={moveOrg} disabled={moving}>{moving ? 'Moving…' : `Move to ${targetOrg.name}`}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setConfirmMove(false); setTargetOrgId(opening.orgId ?? ''); }} disabled={moving}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Offline brief approval ── */}
      <div style={{ borderTop: `1px solid ${NW.gray100}`, paddingTop: 20 }}>
        <span style={label}>Client brief approval</span>
        {briefApproved ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: NW.green600 }}>
            <Icon name="check-circle" size={15} color={NW.green600} />
            Brief already approved — nothing to do here.
          </div>
        ) : briefStatus === null ? (
          <div style={{ fontSize: 12.5, color: NW.gray500, lineHeight: 1.55 }}>
            This opening has no kick-off brief, so there&rsquo;s nothing to approve. Create a brief first if you want the client to review it.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: NW.gray600, lineHeight: 1.55, marginBottom: 10 }}>
              If the client already approved this brief <strong>outside the app</strong> (email, call, meeting),
              record it here so the role goes live without waiting on them to click approve in their portal.
            </div>
            {!confirmApprove ? (
              <Button variant="secondary" size="md" onClick={() => setConfirmApprove(true)}>
                Client approved offline
              </Button>
            ) : (
              <div style={{ background: NW.gray50, border: `1px solid ${NW.gray200}`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 13, color: NW.black, lineHeight: 1.55 }}>
                  Confirm the client approved this brief offline. It will be marked approved and the role
                  published to jobs.nearwork.co. This is recorded in the brief history as an offline approval.
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <Button variant="primary" size="sm" onClick={approveOffline} disabled={approving}>{approving ? 'Recording…' : 'Confirm & publish'}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmApprove(false)} disabled={approving}>Cancel</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
