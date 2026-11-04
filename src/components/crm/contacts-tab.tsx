'use client';

// ============================================================
// Contacts — the people at a client company, each its own record
// (`contacts`), with point-of-contact and decision-maker flags.
// Today's Organization.pocContacts can be brought in with one click.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  db, collection, getDocs, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from '@/lib/firebase';
import { NW, Icon, Button, Avatar } from '@/components/nw/primitives';
import { Card, CardHead } from '@/components/nw/shell-ui';
import { Modal } from '@/components/ui/modal';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { useToast } from '@/components/ui/toast';
import { actorName } from '@/lib/crm';
import type { Contact, Organization } from '@/lib/types';
import { crmField, Field, Pill, Empty, saveErrorMessage } from './ui';

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function useContacts(orgId: string) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, 'contacts'), where('orgId', '==', orgId)));
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact);
      // Point of contact first, then decision-makers, then by name.
      list.sort((a, b) => Number(!!b.isPoc) - Number(!!a.isPoc) || Number(!!b.isDecisionMaker) - Number(!!a.isDecisionMaker) || a.name.localeCompare(b.name));
      setContacts(list);
    } catch (e) {
      console.error('[contacts] load failed', e);
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);
  // Load from Firestore on mount and when the company changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);
  return { contacts, loading, reload };
}

export function ContactsTab({ org }: { org: Organization }) {
  const { showToast } = useToast();
  const { contacts, loading, reload } = useContacts(org.id);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  // Points of contact stored the old way that aren't records yet.
  const key = (name?: string, email?: string) => (email || name || '').trim().toLowerCase();
  const existing = new Set(contacts.map((c) => key(c.name, c.email)));
  const legacy = (org.pocContacts ?? []).filter((p) => p.name && !existing.has(key(p.name, p.email)));

  async function importLegacy() {
    setImporting(true);
    try {
      for (const p of legacy) {
        await addDoc(collection(db, 'contacts'), {
          orgId: org.id, orgName: org.name, name: p.name, title: p.role || null, email: p.email || null,
          phone: p.phone || null, isDecisionMaker: !!p.isDecisionMaker, isPoc: false, source: 'manual',
          createdAt: serverTimestamp(), createdBy: actorName(),
        });
      }
      showToast(`Added ${legacy.length} contact${legacy.length === 1 ? '' : 's'}`);
      await reload();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <Card pad={18}>
        <CardHead
          icon="contact"
          title="Contacts"
          sub="Everyone we talk to at this company"
          action={<Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add contact</Button>}
        />
        {legacy.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: NW.blue50, borderRadius: 10, marginBottom: 14 }}>
            <Icon name="info" size={15} color="#1D4ED8" />
            <span style={{ fontSize: 12.5, color: '#1D4ED8', flex: 1 }}>
              {legacy.length} point{legacy.length === 1 ? '' : 's'} of contact saved on this company aren&apos;t contact records yet.
            </span>
            <Button variant="secondary" size="sm" onClick={importLegacy} disabled={importing}>{importing ? 'Adding…' : 'Bring them in'}</Button>
          </div>
        )}
        {loading ? (
          <div style={{ fontSize: 13, color: NW.gray500, padding: 12 }}>Loading…</div>
        ) : contacts.length === 0 ? (
          <Empty icon="user-plus" title="No contacts yet" sub="Add the point of contact and anyone else involved in the deal." />
        ) : (
          contacts.map((c) => (
            <div key={c.id} onClick={() => setEditing(c)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', borderTop: `1px solid ${NW.gray100}`, cursor: 'pointer' }}>
              <Avatar initials={initialsOf(c.name)} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: NW.black }}>{c.name}</span>
                  {c.isPoc && <Pill fg={NW.teal700} bg={NW.teal50}>Point of contact</Pill>}
                  {c.isDecisionMaker && <Pill fg="#7C3AED" bg={NW.violet50}>Decision-maker</Pill>}
                </div>
                <div style={{ fontSize: 12, color: NW.gray500, marginTop: 2 }}>
                  {[c.title, c.email, c.phone].filter(Boolean).join(' · ') || 'No details yet'}
                </div>
              </div>
              {c.linkedin && (
                <a href={c.linkedin} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="LinkedIn">
                  <Icon name="external-link" size={15} color={NW.gray500} />
                </a>
              )}
              <Icon name="chevron-right" size={15} color={NW.gray300} />
            </div>
          ))
        )}
      </Card>
      {editing && (
        <ContactModal
          org={org}
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function ContactModal({ org, contact, onClose, onDone }: { org: Organization; contact: Contact | null; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [f, setF] = useState({
    name: contact?.name ?? '', title: contact?.title ?? '', email: contact?.email ?? '',
    phone: contact?.phone ?? '', linkedin: contact?.linkedin ?? '',
    isPoc: contact?.isPoc ?? false, isDecisionMaker: contact?.isDecisionMaker ?? false,
  });

  async function save() {
    if (!f.name.trim()) { showToast('Add a name first', 'error'); return; }
    setSaving(true);
    const data = {
      name: f.name.trim(), title: f.title.trim() || null, email: f.email.trim().toLowerCase() || null,
      phone: f.phone.trim() || null, linkedin: f.linkedin.trim() || null,
      isPoc: f.isPoc, isDecisionMaker: f.isDecisionMaker,
    };
    try {
      if (contact) {
        await updateDoc(doc(db, 'contacts', contact.id), { ...data, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'contacts'), {
          ...data, orgId: org.id, orgName: org.name, source: 'manual',
          createdAt: serverTimestamp(), createdBy: actorName(),
        });
      }
      onDone();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
      setSaving(false);
    }
  }

  async function remove() {
    if (!contact) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'contacts', contact.id));
      onDone();
    } catch (e) {
      showToast(saveErrorMessage(e), 'error');
      setDeleting(false);
    }
  }

  const check = (k: 'isPoc' | 'isDecisionMaker', label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: NW.black, cursor: 'pointer' }}>
      <input type="checkbox" checked={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.checked }))} />
      {label}
    </label>
  );

  return (
    <Modal open onClose={onClose} title={contact ? 'Edit contact' : 'New contact'} size="lg">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Name"><input style={crmField} value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Title"><input style={crmField} value={f.title} placeholder="VP of Operations" onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Email"><input style={crmField} value={f.email} type="email" onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><input style={crmField} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="LinkedIn" span><input style={crmField} value={f.linkedin} placeholder="https://www.linkedin.com/in/…" onChange={(e) => setF({ ...f, linkedin: e.target.value })} /></Field>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 22 }}>
          {check('isPoc', 'Point of contact')}
          {check('isDecisionMaker', 'Decision-maker')}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
        {contact && <HoldToDelete onConfirm={remove} busy={deleting} size="sm" label="Hold to delete" />}
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}
