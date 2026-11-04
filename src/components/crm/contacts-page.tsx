'use client';

// ============================================================
// Contacts (/contacts) — every person at every company, searchable,
// like HubSpot's contacts index. Click a row to open the contact.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db, collection, getDocs } from '@/lib/firebase';
import { NW, Icon, Button } from '@/components/nw/primitives';
import { PageHeader, Card, Table, Th, Td, TableRow } from '@/components/nw/shell-ui';
import { MainLayout } from '@/components/layout/main-layout';
import { contactHref } from '@/lib/crm';
import { LIFECYCLE_LABELS, type Contact } from '@/lib/types';
import { crmField, Empty, Field, Pill } from './ui';
import { ContactModal } from './contacts-tab';
import { useOrgOptions } from './deals';

export default function ContactsPage() {
  const router = useRouter();
  const orgs = useOrgOptions();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const [newOrgId, setNewOrgId] = useState('');
  const [creatingFor, setCreatingFor] = useState<{ id: string; name: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    getDocs(collection(db, 'contacts'))
      .then((snap) => setContacts(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact).sort((a, b) => a.name.localeCompare(b.name))))
      .catch((e) => console.error('[contacts] load failed', e))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return contacts;
    return contacts.filter((c) => [c.name, c.email, c.title, c.orgName].some((v) => (v || '').toLowerCase().includes(s)));
  }, [contacts, q]);

  return (
    <MainLayout>
      <PageHeader
        overline="Sales"
        title="Contacts"
        subtitle="Everyone we talk to, across every company."
        actions={<Button icon="plus" onClick={() => setPicking(true)}>Create contact</Button>}
      />
      <div style={{ position: 'relative', maxWidth: 420, marginBottom: 14 }}>
        <span style={{ position: 'absolute', left: 12, top: 11 }}><Icon name="search" size={15} color={NW.gray400} /></span>
        <input style={{ ...crmField, paddingLeft: 34 }} value={q} placeholder="Search by name, email, title or company" onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card pad={6}>
        {loading ? (
          <div style={{ fontSize: 13, color: NW.gray500, padding: 14 }}>Loading contacts…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 12 }}><Empty icon="users" title={contacts.length ? 'No matches' : 'No contacts yet'} sub={contacts.length ? 'Try another search.' : 'Create one here, or from a company’s Contacts tab.'} /></div>
        ) : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Company</Th><Th>Email</Th><Th>Phone</Th><Th>Lifecycle stage</Th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <TableRow key={c.id} onClick={() => router.push(contactHref(c.id))}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    {c.title && <div style={{ fontSize: 12, color: NW.gray500 }}>{c.title}</div>}
                  </Td>
                  <Td>{c.orgName || '—'}</Td>
                  <Td>{c.email || '—'}</Td>
                  <Td>{c.phone || '—'}</Td>
                  <Td>{c.lifecycleStage ? <Pill fg={NW.gray600} bg={NW.gray50}>{LIFECYCLE_LABELS[c.lifecycleStage]}</Pill> : '—'}</Td>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Creating a contact starts by picking the company it belongs to. */}
      {picking && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={() => setPicking(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: NW.white, borderRadius: 16, padding: 22, width: 420, maxWidth: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Which company is this person at?</div>
            <Field label="Company">
              <select style={crmField} value={newOrgId} onChange={(e) => setNewOrgId(e.target.value)}>
                <option value="">Pick a company…</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <Button variant="secondary" onClick={() => setPicking(false)}>Cancel</Button>
              <Button
                disabled={!newOrgId}
                onClick={() => { const o = orgs.find((x) => x.id === newOrgId); if (o) { setCreatingFor(o); setPicking(false); } }}
              >
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}
      {creatingFor && (
        <ContactModal
          org={creatingFor}
          contact={null}
          onClose={() => setCreatingFor(null)}
          onDone={() => { setCreatingFor(null); setReloadKey((k) => k + 1); }}
        />
      )}
    </MainLayout>
  );
}
