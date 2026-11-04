'use client';

// ============================================================
// Contact record (/contacts/[id]) — HubSpot-style three columns:
// left = the person (details, lifecycle stage); middle = the timeline of
// everything linked to them; right = their company and their deals.
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, doc, getDoc, collection, getDocs, query, where, updateDoc, serverTimestamp } from '@/lib/firebase';
import { NW, Button, Avatar } from '@/components/nw/primitives';
import { Card, CardHead, BackBar } from '@/components/nw/shell-ui';
import { MainLayout } from '@/components/layout/main-layout';
import { useToast } from '@/components/ui/toast';
import { fmtUsd, normalizeDealStage } from '@/lib/crm';
import { LIFECYCLE_LABELS, type Contact, type Deal, type LifecycleStage } from '@/lib/types';
import { Timeline } from './timeline';
import { ContactModal, initialsOf } from './contacts-tab';
import { DealModal, dealHref } from './deals';
import { DealStagePill, Empty, Pill, overline, saveErrorMessage } from './ui';

const orgHref = (orgId: string) => `/organizations?id=${encodeURIComponent(orgId)}&tab=contacts`;

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ padding: '9px 0', borderTop: `1px solid ${NW.gray100}` }}>
      <div style={{ fontSize: 11, color: NW.gray500 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: NW.black, marginTop: 2, wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}

export default function ContactRecordPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const router = useRouter();
  const { showToast } = useToast();
  const [contact, setContact] = useState<Contact | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creatingDeal, setCreatingDeal] = useState(false);

  const load = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, 'contacts', id));
      if (!snap.exists()) { setMissing(true); return; }
      setContact({ ...snap.data(), id: snap.id } as Contact);
      const d = await getDocs(query(collection(db, 'deals'), where('contactIds', 'array-contains', id)));
      setDeals(d.docs.map((x) => { const y = { ...x.data(), id: x.id } as Deal; return { ...y, stage: normalizeDealStage(y.stage) }; }));
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    }
  }, [id, showToast]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function setLifecycle(stage: LifecycleStage) {
    if (!contact) return;
    try {
      await updateDoc(doc(db, 'contacts', contact.id), { lifecycleStage: stage, updatedAt: serverTimestamp() });
      setContact({ ...contact, lifecycleStage: stage });
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    }
  }

  if (missing) {
    return (
      <MainLayout>
        <BackBar label="Contacts" href="/contacts" />
        <Card><Empty icon="user" title="Contact not found" sub="It may have been deleted." /></Card>
      </MainLayout>
    );
  }
  if (!contact) {
    return <MainLayout><div style={{ fontSize: 13, color: NW.gray500, padding: 20 }}>Loading contact…</div></MainLayout>;
  }

  const org = { id: contact.orgId, name: contact.orgName || '' };

  return (
    <MainLayout>
      <BackBar label="Contacts" href="/contacts" />
      <div className="nw-grid-3col" style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 290px', gap: 16, alignItems: 'start' }}>
        {/* ── Left: the person ── */}
        <div style={{ display: 'grid', gap: 16 }}>
          <Card pad={18}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar initials={initialsOf(contact.name)} size={44} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: NW.black, letterSpacing: '-0.01em' }}>{contact.name}</div>
                <div style={{ fontSize: 13, color: NW.gray500 }}>{contact.title || 'No title'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {contact.isPoc && <Pill fg={NW.teal700} bg={NW.teal50}>Point of contact</Pill>}
              {contact.isDecisionMaker && <Pill fg="#7C3AED" bg={NW.violet50}>Decision-maker</Pill>}
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={overline}>Lifecycle stage</div>
              <select
                value={contact.lifecycleStage ?? 'lead'}
                onChange={(e) => setLifecycle(e.target.value as LifecycleStage)}
                style={{ marginTop: 6, width: '100%', fontSize: 13.5, padding: '9px 12px', border: `1px solid ${NW.gray200}`, borderRadius: 10, background: NW.white }}
              >
                {(Object.keys(LIFECYCLE_LABELS) as LifecycleStage[]).map((k) => <option key={k} value={k}>{LIFECYCLE_LABELS[k]}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 14 }}>
              <Button variant="secondary" size="sm" icon="pencil" onClick={() => setEditing(true)} fullWidth>Edit contact</Button>
            </div>
          </Card>
          <Card pad={18}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>About this contact</div>
            <Prop label="Email">{contact.email ? <a href={`mailto:${contact.email}`} style={{ color: NW.teal600 }}>{contact.email}</a> : '—'}</Prop>
            <Prop label="Phone">{contact.phone ? <a href={`tel:${contact.phone}`} style={{ color: NW.teal600 }}>{contact.phone}</a> : '—'}</Prop>
            <Prop label="LinkedIn">{contact.linkedin ? <a href={contact.linkedin} target="_blank" rel="noreferrer" style={{ color: NW.teal600 }}>Open profile</a> : '—'}</Prop>
            <Prop label="Company">{contact.orgName || '—'}</Prop>
            <Prop label="Added">{contact.createdBy ? `By ${contact.createdBy}` : '—'}</Prop>
          </Card>
        </div>

        {/* ── Middle: timeline ── */}
        <Timeline
          scope={{ kind: 'contact', contactId: contact.id }}
          context={{ orgId: contact.orgId, orgName: contact.orgName, contactIds: [contact.id], dealIds: deals.length === 1 ? [deals[0].id] : [] }}
        />

        {/* ── Right: company and deals ── */}
        <div style={{ display: 'grid', gap: 16 }}>
          <Card pad={18}>
            <CardHead title="Company" />
            <div onClick={() => router.push(orgHref(contact.orgId))} style={{ cursor: 'pointer', border: `1px solid ${NW.gray100}`, borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: NW.black }}>{contact.orgName || 'Open company'}</div>
            </div>
          </Card>
          <Card pad={18}>
            <CardHead title={`Deals (${deals.length})`} action={<Button variant="ghost" size="sm" icon="plus" onClick={() => setCreatingDeal(true)}>Create</Button>} />
            {deals.length === 0 ? (
              <div style={{ fontSize: 12.5, color: NW.gray500 }}>Not on any deal yet.</div>
            ) : deals.map((d) => (
              <div key={d.id} onClick={() => router.push(dealHref(d.id))} style={{ padding: '10px 0', borderTop: `1px solid ${NW.gray100}`, cursor: 'pointer' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{d.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <DealStagePill stage={d.stage} />
                  {d.mrr ? <span style={{ fontSize: 12, color: NW.teal700, fontWeight: 600 }}>{fmtUsd(d.mrr)}/mo</span> : null}
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      {editing && (
        <ContactModal
          org={org}
          contact={contact}
          onClose={() => setEditing(false)}
          onDone={(deleted) => { setEditing(false); if (deleted) router.push('/contacts'); else load(); }}
        />
      )}
      {creatingDeal && (
        <DealModal
          deal={null}
          orgs={[org]}
          fixedOrg={org}
          presetContactId={contact.id}
          onClose={() => setCreatingDeal(false)}
          onDone={(dealId) => { setCreatingDeal(false); if (dealId) router.push(dealHref(dealId)); }}
        />
      )}
    </MainLayout>
  );
}
