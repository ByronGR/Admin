'use client';

import { useState, useEffect } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { fmtDate, initials } from '@/lib/utils';
import type { Organization, Pipeline, OrgPackage, OrgContractType } from '@/lib/types';
import { Search, Plus, Building2, ExternalLink, ChevronRight, X, Edit3, Trash2 } from 'lucide-react';

// ─── Status badge helper ──────────────────────────────────────────────────────

function orgStatusVariant(status: string) {
  if (status === 'active') return 'green';
  if (status === 'inactive' || status === 'suspended') return 'red';
  return 'amber';
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrganizationsPage() {
  const { showToast } = useToast();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Organization | null>(null);

  // New org modal
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({
    name: '', website: '', country: '', city: '',
    industry: '', package: '', contractType: '', hubspotLink: '', status: 'active',
    inviteEmails: '', // comma-separated user emails to invite
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'organizations'));
      setOrgs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Organization)));
    } catch {
      showToast('Failed to load organizations', 'error');
    } finally {
      setLoading(false);
    }
  }

  const filtered = orgs.filter((o) => {
    const q = search.toLowerCase();
    const matchSearch = !q || [o.name, o.website, o.industry].join(' ').toLowerCase().includes(q);
    const matchStatus = !statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function saveOrg() {
    if (!form.name) {
      showToast('Organization name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      // Generate org ID
      const orgId = form.name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6);

      // Build org users from invite emails
      const orgUsers = form.inviteEmails
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
        .map((email) => ({
          email,
          status: 'invited',
          invitedAt: new Date().toISOString(),
        }));

      await addDoc(collection(db, 'organizations'), {
        name: form.name,
        website: form.website,
        country: form.country,
        city: form.city,
        industry: form.industry,
        package: form.package ? (form.package as OrgPackage) : null,
        contractType: form.contractType ? (form.contractType as OrgContractType) : null,
        hubspotLink: form.hubspotLink || null,
        status: form.status,
        orgUsers: orgUsers.length ? orgUsers : [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast('Organization created', 'success');
      setNewModal(false);
      setForm({ name: '', website: '', country: '', city: '', industry: '', package: '', contractType: '', hubspotLink: '', status: 'active', inviteEmails: '' });
      load();
    } catch {
      showToast('Failed to create organization', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">
              {selected ? selected.name : 'Organizations'}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              {selected
                ? `Org ID: ${selected.id}`
                : `${orgs.length} client organization${orgs.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex gap-2">
            {selected && (
              <button
                onClick={() => setSelected(null)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                <X className="h-3.5 w-3.5" />
                All orgs
              </button>
            )}
            {!selected && (
              <button
                onClick={() => setNewModal(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
                style={{ background: 'var(--green)' }}
              >
                <Plus className="h-3.5 w-3.5" />
                New organization
              </button>
            )}
          </div>
        </div>

        {selected ? (
          <OrgDetail org={selected} onClose={() => setSelected(null)} onRefresh={load} />
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search organizations..."
                  className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="prospect">Prospect</option>
              </select>
            </div>

            {/* Table */}
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                <div className="grid grid-cols-[auto_2fr_1fr_1fr_1fr] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                  <div className="w-10"></div>
                  <div>Organization</div>
                  <div>Industry</div>
                  <div>Status</div>
                  <div></div>
                </div>
                {filtered.length === 0 ? (
                  <div className="py-16 text-center text-sm text-[var(--light)]">
                    No organizations found.
                  </div>
                ) : (
                  filtered.map((o) => (
                    <div
                      key={o.id}
                      className="grid grid-cols-[auto_2fr_1fr_1fr_1fr] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)] cursor-pointer"
                      onClick={() => setSelected(o)}
                    >
                      <div className="w-10">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-800 text-white"
                          style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
                        >
                          {initials(o.name)}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-600 text-[var(--black)]">{o.name}</p>
                        {o.website && (
                          <p className="truncate text-[10px] text-[var(--light)]">{o.website}</p>
                        )}
                      </div>
                      <div className="text-xs text-[var(--mid)]">{o.industry ?? '—'}</div>
                      <div>
                        <Badge
                          label={o.status ?? 'active'}
                          variant={orgStatusVariant(o.status ?? 'active') as 'green' | 'amber' | 'red'}
                        />
                      </div>
                      <div className="flex justify-end">
                        <ChevronRight className="h-4 w-4 text-[var(--light)]" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* New org modal */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="New organization" size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Organization name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Acme Inc."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Website</label>
            <input
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              placeholder="acme.com"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Industry</label>
            <input
              value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
              placeholder="Technology"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Country</label>
            <input
              value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              placeholder="USA"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">City</label>
            <input
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="New York"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Package</label>
            <select
              value={form.package}
              onChange={(e) => setForm((f) => ({ ...f, package: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            >
              <option value="">Select package…</option>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
              <option value="eor">EOR</option>
              <option value="spp">SPP</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Contract type</label>
            <select
              value={form.contractType}
              onChange={(e) => setForm((f) => ({ ...f, contractType: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            >
              <option value="">Select type…</option>
              <option value="managed_team">Managed Team</option>
              <option value="eor">EOR</option>
              <option value="spp">SPP</option>
              <option value="direct">Direct</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">HubSpot link</label>
            <input
              value={form.hubspotLink}
              onChange={(e) => setForm((f) => ({ ...f, hubspotLink: e.target.value }))}
              placeholder="https://app.hubspot.com/contacts/…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Invite org users</label>
            <input
              value={form.inviteEmails}
              onChange={(e) => setForm((f) => ({ ...f, inviteEmails: e.target.value }))}
              placeholder="hr@acme.com, ceo@acme.com"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
            <p className="mt-1 text-[10px] text-[var(--light)]">
              Comma-separated. These users will receive an invitation to create an account at app.nearwork.co.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => setNewModal(false)}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]"
          >
            Cancel
          </button>
          <button
            onClick={saveOrg}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}
          >
            {saving && <Spinner size="sm" />}
            Create organization
          </button>
        </div>
      </Modal>
    </MainLayout>
  );
}

// ─── Org detail ───────────────────────────────────────────────────────────────

function OrgDetail({
  org,
  onClose,
  onRefresh,
}: {
  org: Organization;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editForm, setEditForm] = useState({
    name: org.name,
    website: org.website ?? '',
    country: org.country ?? '',
    city: org.city ?? '',
    industry: org.industry ?? '',
    package: org.package ?? '',
    contractType: org.contractType ?? '',
    hubspotLink: org.hubspotLink ?? '',
    status: org.status ?? 'active',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDocs(query(collection(db, 'pipelines'), where('orgId', '==', org.id)))
      .then((snap) => {
        setPipelines(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Pipeline)));
        setLoadingPipelines(false);
      })
      .catch(() => setLoadingPipelines(false));
  }, [org.id]);

  async function saveEdits() {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'organizations', org.id), {
        name: editForm.name,
        website: editForm.website,
        country: editForm.country,
        city: editForm.city,
        industry: editForm.industry,
        package: editForm.package ? (editForm.package as OrgPackage) : null,
        contractType: editForm.contractType ? (editForm.contractType as OrgContractType) : null,
        hubspotLink: editForm.hubspotLink || null,
        status: editForm.status,
        updatedAt: serverTimestamp(),
      });
      showToast('Organization updated', 'success');
      setEditing(false);
      onRefresh();
    } catch {
      showToast('Failed to update', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'organizations', org.id));
      showToast('Organization deleted', 'success');
      onRefresh();
      onClose();
    } catch {
      showToast('Failed to delete organization', 'error');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Left: details + edit */}
      <div className="space-y-5">
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="mb-4 flex items-center gap-4">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl text-base font-800 text-white"
              style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
            >
              {initials(org.name)}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-700 text-[var(--black)]">{org.name}</h2>
              {org.website && (
                <a
                  href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-[var(--green)] hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {org.website}
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge label={org.status ?? 'active'} variant="status" />
              <button
                onClick={() => setEditing((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit
              </button>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 font-500">Delete this org?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-xs font-700 text-red-600 hover:underline disabled:opacity-60"
                  >
                    {deleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-[var(--mid)] hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-500 text-red-500 hover:border-red-400 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
            </div>
          </div>

          {!editing ? (
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              {[
                { label: 'Industry', value: org.industry },
                { label: 'Country', value: org.country },
                { label: 'City', value: org.city },
                { label: 'Package', value: org.package },
                { label: 'Contract Type', value: org.contractType?.replace('_', ' ') },
                { label: 'Created', value: fmtDate(org.createdAt) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">{label}</p>
                  <p className="mt-0.5 capitalize text-[var(--black)]">{value ?? '—'}</p>
                </div>
              ))}
              {org.hubspotLink && (
                <div className="sm:col-span-3">
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">HubSpot</p>
                  <a
                    href={org.hubspotLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 text-[var(--green)] hover:underline"
                  >
                    {org.hubspotLink}
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { key: 'name', label: 'Name' },
                { key: 'website', label: 'Website' },
                { key: 'country', label: 'Country' },
                { key: 'city', label: 'City' },
                { key: 'industry', label: 'Industry' },
                { key: 'hubspotLink', label: 'HubSpot link' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    {label}
                  </label>
                  <input
                    value={(editForm as Record<string, string>)[key]}
                    onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
                  />
                </div>
              ))}
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Package</label>
                <select
                  value={editForm.package}
                  onChange={(e) => setEditForm((f) => ({ ...f, package: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
                >
                  <option value="">None</option>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="eor">EOR</option>
                  <option value="spp">SPP</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Contract type</label>
                <select
                  value={editForm.contractType}
                  onChange={(e) => setEditForm((f) => ({ ...f, contractType: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
                >
                  <option value="">None</option>
                  <option value="managed_team">Managed Team</option>
                  <option value="eor">EOR</option>
                  <option value="spp">SPP</option>
                  <option value="direct">Direct</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as 'active' | 'inactive' | 'prospect' }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="prospect">Prospect</option>
                </select>
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <button
                  onClick={saveEdits}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
                  style={{ background: 'var(--green)' }}
                >
                  {saving && <Spinner size="sm" />}
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right column */}
      <div className="space-y-4">
        {/* Org users */}
        {(org.orgUsers ?? []).length > 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-3 text-sm font-600 text-[var(--black)]">
              Client users ({org.orgUsers?.length ?? 0})
            </h3>
            <div className="space-y-2">
              {(org.orgUsers ?? []).map((u) => (
                <div key={u.email} className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2">
                  <p className="text-xs text-[var(--black)]">{u.email}</p>
                  <span className={`text-[10px] font-600 ${u.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {u.status === 'active' ? 'Active' : 'Invited'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pipelines */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h3 className="mb-3 text-sm font-600 text-[var(--black)]">
            Pipelines ({pipelines.length})
          </h3>
          {loadingPipelines ? (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          ) : pipelines.length === 0 ? (
            <p className="text-xs text-[var(--light)]">No pipelines yet for this org.</p>
          ) : (
            <div className="space-y-2">
              {pipelines.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-[var(--border)] p-3 hover:border-[var(--green)]"
                >
                  <p className="text-xs font-600 text-[var(--black)]">{p.title}</p>
                  <p className="text-[10px] text-[var(--light)]">
                    {p.code} · {p.candidates?.length ?? 0} candidates
                  </p>
                  <div className="mt-1">
                    <Badge label={p.status} variant="status" className="text-[9px]" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
