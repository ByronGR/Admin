'use client';

import { useState, useEffect, useRef } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
  query,
  where,
  storage,
  ref,
  uploadBytes,
  getDownloadURL,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { fmtDate, initials, genSafeId } from '@/lib/utils';
import type { Organization, Pipeline, Placement, Opening, OrgPackage, OrgContractType, OrgUser } from '@/lib/types';
import { buildInviteEmail } from './invite-email';
import {
  Search, Plus, Building2, ExternalLink, ChevronRight, X,
  Edit3, Trash2, Mail, UserPlus, UserMinus, RefreshCw,
  Link2, Camera, Briefcase, Trophy, Users, TrendingUp,
} from 'lucide-react';

// ─── Package definitions (from nearwork.co/pricing) ───────────────────────────

interface PkgInfo {
  label: string;
  price: string;
  fee: string;
  tagline: string;
  color: string;
  bg: string;
}

const PACKAGES: Record<string, PkgInfo> = {
  essential: { label: 'Essential', price: '$0 / mo', fee: '$3,490 fee', tagline: 'Best for one-role hiring', color: '#555555', bg: '#F5F5F5' },
  starter:   { label: 'Essential', price: '$0 / mo', fee: '$3,490 fee', tagline: 'Best for one-role hiring', color: '#555555', bg: '#F5F5F5' },
  growth:    { label: 'Growth',    price: '$990 / mo', fee: '$1,990 fee', tagline: 'Best for ongoing hiring', color: '#16A085', bg: '#E8F8F5' },
  scale:     { label: 'Scale',    price: '$2,500 / mo', fee: '$1,300 fee', tagline: 'Long-term hiring pipeline', color: '#7D3C98', bg: '#F3EEF8' },
  enterprise:{ label: 'Scale',    price: '$2,500 / mo', fee: '$1,300 fee', tagline: 'Long-term hiring pipeline', color: '#7D3C98', bg: '#F3EEF8' },
  eor:       { label: 'EOR',      price: 'Custom', fee: 'Custom', tagline: 'Employer of Record', color: '#C0392B', bg: '#FEF0F0' },
  spp:       { label: 'SPP',      price: 'Custom', fee: 'Custom', tagline: 'Staff Plus Program', color: '#D35400', bg: '#FEF5EB' },
};

function getPkg(key?: string | null): PkgInfo | null {
  if (!key) return null;
  return PACKAGES[key] ?? null;
}

// ─── Resend invite ────────────────────────────────────────────────────────────

async function sendInviteEmail(
  email: string,
  orgId: string,
  orgName: string
): Promise<{ token: string; success: boolean }> {
  const token = crypto.randomUUID();
  const firstName = email.split('@')[0].split('.')[0];
  const firstName1 = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  const setupLink = `https://app.nearwork.co/join?token=${token}&email=${encodeURIComponent(email)}`;

  // Store invite in Firestore (even if email fails)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await setDoc(doc(db, 'org_invites', token), {
    token,
    email,
    orgId,
    orgName,
    status: 'pending',
    createdAt: serverTimestamp(),
    expiresAt,
    setupLink,
  });

  // Send via Resend
  const key = process.env.NEXT_PUBLIC_RESEND_API_KEY;
  if (!key || key === 're_your_key_here') {
    console.warn('[Nearwork] Resend API key not set — invite stored in Firestore only');
    return { token, success: false };
  }

  try {
    const html = buildInviteEmail(firstName1, orgName, setupLink);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from: 'Nearwork <noreply@nearwork.co>',
        to: [email],
        subject: `Set up your Nearwork account — ${orgName}`,
        html,
      }),
    });
    return { token, success: res.ok };
  } catch {
    return { token, success: false };
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function orgStatusVariant(status: string) {
  if (status === 'active') return 'green';
  if (status === 'inactive' || status === 'suspended') return 'red';
  return 'amber';
}

// ─── Org avatar (logo or initials) ───────────────────────────────────────────

function OrgAvatar({ org, size = 'md' }: { org: Organization; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-12 w-12 text-sm', lg: 'h-16 w-16 text-base' };
  if (org.logo) {
    return (
      <img
        src={org.logo}
        alt={org.name}
        className={`${sizes[size]} rounded-xl object-cover shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${sizes[size]} flex shrink-0 items-center justify-center rounded-xl font-800 text-white`}
      style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
    >
      {initials(org.name)}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrganizationsPage() {
  const { showToast } = useToast();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Organization | null>(null);

  // New org modal
  const [newModal, setNewModal] = useState(false);
  const [form, setForm] = useState({
    name: '', website: '', country: '', city: '',
    industry: '', package: '', contractType: '', hubspotLink: '',
    status: 'active', inviteEmail: '',
  });
  const [saving, setSaving] = useState(false);

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => { load(); }, []);

  // URL sync: read ?id= on mount to support direct linking
  useEffect(() => {
    if (orgs.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id && !selected) {
      const org = orgs.find((o) => o.id === id);
      if (org) selectOrg(org);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs]);

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

  function selectOrg(org: Organization | null) {
    setSelected(org);
    if (org) {
      window.history.pushState(null, '', `/organizations?id=${org.id}`);
    } else {
      window.history.pushState(null, '', '/organizations');
    }
  }

  const filtered = orgs.filter((o) => {
    const q = search.toLowerCase();
    const matchSearch = !q || [o.name, o.website, o.industry, o.city, o.country].join(' ').toLowerCase().includes(q);
    const matchStatus = !statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // ── Create org ─────────────────────────────────────────────────────────────

  async function saveOrg() {
    if (!form.name.trim()) { showToast('Organization name is required', 'error'); return; }
    setSaving(true);
    try {
      const shortId = genSafeId(6);
      const docRef = await addDoc(collection(db, 'organizations'), {
        name: form.name.trim(),
        shortId,
        website: form.website || null,
        country: form.country || null,
        city: form.city || null,
        industry: form.industry || null,
        package: form.package || null,
        contractType: form.contractType || null,
        hubspotLink: form.hubspotLink || null,
        status: form.status,
        orgUsers: [],
        logo: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Send invite if email provided
      if (form.inviteEmail.trim()) {
        const { success } = await sendInviteEmail(form.inviteEmail.trim(), docRef.id, form.name.trim());
        // Add to orgUsers
        await updateDoc(doc(db, 'organizations', docRef.id), {
          orgUsers: [{ email: form.inviteEmail.trim(), status: 'invited', invitedAt: new Date().toISOString() }],
        });
        showToast(success ? 'Organization created · Invite email sent ✓' : 'Organization created · Invite stored (check Resend API key)', success ? 'success' : 'info');
      } else {
        showToast('Organization created', 'success');
      }

      setNewModal(false);
      setForm({ name: '', website: '', country: '', city: '', industry: '', package: '', contractType: '', hubspotLink: '', status: 'active', inviteEmail: '' });
      await load();
    } catch (err) {
      console.error(err);
      showToast('Failed to create organization', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────

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
                ? `ID: ${selected.shortId ?? selected.id.slice(0, 8).toUpperCase()}`
                : `${orgs.length} client organization${orgs.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex gap-2">
            {selected ? (
              <>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    showToast('Link copied!', 'success');
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Copy link
                </button>
                <button
                  onClick={() => selectOrg(null)}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
                >
                  <X className="h-3.5 w-3.5" />
                  All orgs
                </button>
              </>
            ) : (
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
          <OrgDetail
            key={selected.id}
            org={selected}
            onClose={() => selectOrg(null)}
            onRefresh={async () => { await load(); }}
            onUpdated={(updated) => setSelected(updated)}
          />
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search organizations…"
                  className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-[var(--green)]"
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
              <div className="flex h-40 items-center justify-center"><Spinner /></div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                <div className="grid grid-cols-[auto_2fr_1fr_1fr_auto] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-5 py-3 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                  <div className="w-12"></div>
                  <div>Organization</div>
                  <div>Package</div>
                  <div>Status</div>
                  <div></div>
                </div>
                {filtered.length === 0 ? (
                  <div className="py-16 text-center text-sm text-[var(--light)]">No organizations found.</div>
                ) : (
                  filtered.map((o) => {
                    const pkg = getPkg(o.package);
                    return (
                      <div
                        key={o.id}
                        onClick={() => selectOrg(o)}
                        className="grid cursor-pointer grid-cols-[auto_2fr_1fr_1fr_auto] items-center gap-0 border-b border-[var(--border)] px-5 py-3.5 last:border-0 transition-colors hover:bg-[var(--bg)]"
                      >
                        <div className="w-12">
                          <OrgAvatar org={o} size="sm" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-600 text-[var(--black)]">{o.name}</p>
                          <p className="truncate text-[11px] text-[var(--light)]">
                            {[o.city, o.country].filter(Boolean).join(', ') || o.website || o.industry || '—'}
                          </p>
                        </div>
                        <div>
                          {pkg ? (
                            <span
                              className="rounded-full px-2.5 py-1 text-[10px] font-700"
                              style={{ background: pkg.bg, color: pkg.color }}
                            >
                              {pkg.label}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--light)]">—</span>
                          )}
                        </div>
                        <div>
                          <Badge label={o.status ?? 'active'} variant={orgStatusVariant(o.status ?? 'active') as 'green' | 'amber' | 'red'} />
                        </div>
                        <div>
                          <ChevronRight className="h-4 w-4 text-[var(--light)]" />
                        </div>
                      </div>
                    );
                  })
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
              autoFocus
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>

          {/* Package selector */}
          <div className="sm:col-span-2">
            <label className="mb-2 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Plan</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(['essential', 'growth', 'scale', 'eor', 'spp'] as const).map((key) => {
                const p = PACKAGES[key];
                const selected = form.package === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, package: key }))}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      selected ? 'shadow-sm' : 'border-[var(--border)] hover:border-[var(--green)]'
                    }`}
                    style={selected ? { borderColor: p.color, background: p.bg } : {}}
                  >
                    <p className="text-xs font-700" style={{ color: selected ? p.color : 'var(--black)' }}>
                      {p.label}
                    </p>
                    <p className="mt-0.5 text-[10px]" style={{ color: selected ? p.color : 'var(--light)' }}>
                      {p.price}
                    </p>
                    <p className="text-[10px]" style={{ color: selected ? p.color : 'var(--light)' }}>
                      {p.fee}
                    </p>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, package: '' }))}
                className={`rounded-xl border p-3 text-left transition-all ${
                  !form.package ? 'border-[var(--black)] bg-[var(--bg)]' : 'border-[var(--border)] hover:border-[var(--green)]'
                }`}
              >
                <p className="text-xs font-700 text-[var(--mid)]">None</p>
                <p className="mt-0.5 text-[10px] text-[var(--light)]">No plan yet</p>
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Website</label>
            <input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              placeholder="acme.com"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Industry</label>
            <input value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
              placeholder="Technology"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Country</label>
            <input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              placeholder="United States"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">City</label>
            <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="New York"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Contract type</label>
            <select value={form.contractType} onChange={(e) => setForm((f) => ({ ...f, contractType: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]">
              <option value="">Select…</option>
              <option value="managed_team">Managed Team</option>
              <option value="eor">EOR</option>
              <option value="spp">SPP</option>
              <option value="direct">Direct</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Status</label>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]">
              <option value="active">Active</option>
              <option value="prospect">Prospect</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">HubSpot link</label>
            <input value={form.hubspotLink} onChange={(e) => setForm((f) => ({ ...f, hubspotLink: e.target.value }))}
              placeholder="https://app.hubspot.com/contacts/…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
          </div>
          <div className="sm:col-span-2 rounded-xl bg-[var(--bg)] p-4">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--green)]">
              Invite first user (optional)
            </label>
            <input value={form.inviteEmail} onChange={(e) => setForm((f) => ({ ...f, inviteEmail: e.target.value }))}
              placeholder="cto@acme.com"
              type="email"
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]" />
            <p className="mt-1.5 text-[10px] text-[var(--light)]">
              They'll receive an invitation email to create their account at app.nearwork.co
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <button onClick={() => setNewModal(false)}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">
            Cancel
          </button>
          <button onClick={saveOrg} disabled={saving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}>
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
  onUpdated,
}: {
  org: Organization;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onUpdated: (updated: Organization) => void;
}) {
  const { showToast } = useToast();
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Related data
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // UI state
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  // Edit form
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

  // Users state
  const [addUserEmail, setAddUserEmail] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [invitesSending, setInvitesSending] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'pipelines'), where('orgId', '==', org.id))),
      getDocs(query(collection(db, 'placements'), where('orgId', '==', org.id))),
      getDocs(query(collection(db, 'openings'), where('orgId', '==', org.id))),
    ]).then(([pSnap, plSnap, oSnap]) => {
      setPipelines(pSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Pipeline)));
      setPlacements(plSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Placement)));
      setOpenings(oSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Opening)));
      setDataLoading(false);
    }).catch(() => setDataLoading(false));
  }, [org.id]);

  const pkg = getPkg(org.package);
  const activeOpenings = openings.filter((o) => o.status === 'open').length;
  const activePlacements = placements.filter((p) => p.status === 'active').length;
  const orgUsers: OrgUser[] = org.orgUsers ?? [];

  // ── Logo upload ────────────────────────────────────────────────────────────

  async function handleLogoUpload(file: File) {
    setLogoUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const storageRef = ref(storage, `org-logos/${org.id}.${ext}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'organizations', org.id), { logo: url, updatedAt: serverTimestamp() });
      onUpdated({ ...org, logo: url });
      showToast('Logo updated', 'success');
    } catch {
      showToast('Failed to upload logo', 'error');
    } finally {
      setLogoUploading(false);
    }
  }

  // ── Save edits ─────────────────────────────────────────────────────────────

  async function saveEdits() {
    setSaving(true);
    try {
      const data = {
        name: editForm.name.trim(),
        website: editForm.website || null,
        country: editForm.country || null,
        city: editForm.city || null,
        industry: editForm.industry || null,
        package: editForm.package ? (editForm.package as OrgPackage) : null,
        contractType: editForm.contractType ? (editForm.contractType as OrgContractType) : null,
        hubspotLink: editForm.hubspotLink || null,
        status: editForm.status,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'organizations', org.id), data);
      const { updatedAt: _ts, ...dataWithoutTs } = data;
      onUpdated({ ...org, ...dataWithoutTs } as Organization);
      showToast('Saved', 'success');
      setEditing(false);
      await onRefresh();
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete org ─────────────────────────────────────────────────────────────

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'organizations', org.id));
      showToast('Organization deleted', 'success');
      onClose();
      await onRefresh();
    } catch {
      showToast('Failed to delete', 'error');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async function addUser() {
    const email = addUserEmail.trim().toLowerCase();
    if (!email) return;
    if (orgUsers.some((u) => u.email === email)) {
      showToast('User already added', 'info');
      return;
    }
    setAddingUser(true);
    try {
      const newUser: OrgUser = { email, status: 'invited', invitedAt: new Date().toISOString() };
      const updatedUsers = [...orgUsers, newUser];
      await updateDoc(doc(db, 'organizations', org.id), { orgUsers: updatedUsers, updatedAt: serverTimestamp() });
      onUpdated({ ...org, orgUsers: updatedUsers });

      // Send invite
      const { success } = await sendInviteEmail(email, org.id, org.name);
      showToast(
        success ? `Invite sent to ${email}` : `User added · check Resend API key to send email`,
        success ? 'success' : 'info'
      );
      setAddUserEmail('');
    } catch {
      showToast('Failed to add user', 'error');
    } finally {
      setAddingUser(false);
    }
  }

  async function removeUser(email: string) {
    try {
      const updatedUsers = orgUsers.filter((u) => u.email !== email);
      await updateDoc(doc(db, 'organizations', org.id), { orgUsers: updatedUsers, updatedAt: serverTimestamp() });
      onUpdated({ ...org, orgUsers: updatedUsers });
      showToast('User removed', 'success');
    } catch {
      showToast('Failed to remove user', 'error');
    }
  }

  async function resendInvite(email: string) {
    setInvitesSending((s) => new Set(s).add(email));
    try {
      const { success } = await sendInviteEmail(email, org.id, org.name);
      showToast(success ? `Invite resent to ${email}` : 'Invite token created (check Resend API key)', success ? 'success' : 'info');
    } finally {
      setInvitesSending((s) => { const n = new Set(s); n.delete(email); return n; });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Hero card */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="flex flex-wrap items-start gap-5">
          {/* Logo with upload button */}
          <div className="relative shrink-0">
            {org.logo ? (
              <img src={org.logo} alt={org.name} className="h-16 w-16 rounded-2xl object-cover" />
            ) : (
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-800 text-white"
                style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
              >
                {initials(org.name)}
              </div>
            )}
            <button
              onClick={() => logoInputRef.current?.click()}
              disabled={logoUploading}
              className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[var(--green)] text-white shadow-sm transition-transform hover:scale-110 disabled:opacity-60"
              title="Upload logo"
            >
              {logoUploading ? <div className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" /> : <Camera className="h-3 w-3" />}
            </button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleLogoUpload(e.target.files[0]); }}
            />
          </div>

          {/* Name + meta */}
          <div className="min-w-0 flex-1">
            {!editing ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-700 text-[var(--black)]">{org.name}</h2>
                  <Badge label={org.status ?? 'active'} variant={orgStatusVariant(org.status ?? 'active') as 'green' | 'amber' | 'red'} />
                  {pkg && (
                    <span className="rounded-full px-2.5 py-0.5 text-[10px] font-700" style={{ background: pkg.bg, color: pkg.color }}>
                      {pkg.label}
                    </span>
                  )}
                </div>
                {org.website && (
                  <a href={org.website.startsWith('http') ? org.website : `https://${org.website}`} target="_blank" rel="noopener noreferrer"
                    className="mt-0.5 flex items-center gap-1 text-xs text-[var(--green)] hover:underline">
                    <ExternalLink className="h-3 w-3" />{org.website}
                  </a>
                )}
                <p className="mt-1 text-xs text-[var(--light)]">
                  {[org.industry, org.city, org.country].filter(Boolean).join(' · ') || '—'}
                </p>
                {org.shortId && (
                  <p className="mt-1 text-[10px] font-600 text-[var(--light)]">
                    Org ID: <span className="font-800 text-[var(--mid)] tracking-widest">{org.shortId}</span>
                  </p>
                )}
              </>
            ) : (
              /* Edit form */
              <div className="grid gap-3 sm:grid-cols-2">
                {(['name', 'website', 'country', 'city', 'industry', 'hubspotLink'] as const).map((key) => (
                  <div key={key} className={key === 'name' || key === 'hubspotLink' ? 'sm:col-span-2' : ''}>
                    <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                      {key === 'hubspotLink' ? 'HubSpot link' : key.charAt(0).toUpperCase() + key.slice(1)}
                    </label>
                    <input
                      value={(editForm as Record<string, string>)[key]}
                      onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--green)]"
                    />
                  </div>
                ))}
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Status</label>
                  <select value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--green)]">
                    <option value="active">Active</option>
                    <option value="prospect">Prospect</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Contract type</label>
                  <select value={editForm.contractType} onChange={(e) => setEditForm((f) => ({ ...f, contractType: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--green)]">
                    <option value="">None</option>
                    <option value="managed_team">Managed Team</option>
                    <option value="eor">EOR</option>
                    <option value="spp">SPP</option>
                    <option value="direct">Direct</option>
                  </select>
                </div>
                {/* Package picker */}
                <div className="sm:col-span-2">
                  <label className="mb-2 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Plan</label>
                  <div className="flex flex-wrap gap-1.5">
                    {(['essential', 'growth', 'scale', 'eor', 'spp', ''] as const).map((key) => {
                      const p = key ? PACKAGES[key] : null;
                      const isSelected = editForm.package === key;
                      return (
                        <button key={key || 'none'} type="button"
                          onClick={() => setEditForm((f) => ({ ...f, package: key }))}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-600 transition-colors ${isSelected ? 'text-white border-transparent' : 'border-[var(--border)] text-[var(--mid)] hover:border-[var(--green)]'}`}
                          style={isSelected && p ? { background: p.color } : isSelected ? { background: 'var(--mid)' } : {}}>
                          {p ? p.label : 'None'}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="sm:col-span-2 flex gap-2">
                  <button onClick={saveEdits} disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
                    style={{ background: 'var(--green)' }}>
                    {saving && <Spinner size="sm" />}Save changes
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          {!editing && (
            <div className="flex flex-wrap gap-2">
              {org.hubspotLink && (
                <a href={org.hubspotLink} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]">
                  <ExternalLink className="h-3.5 w-3.5" />HubSpot
                </a>
              )}
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]">
                <Edit3 className="h-3.5 w-3.5" />Edit
              </button>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-500 text-red-600">Delete org?</span>
                  <button onClick={handleDelete} disabled={deleting}
                    className="text-xs font-700 text-red-600 hover:underline disabled:opacity-60">
                    {deleting ? 'Deleting…' : 'Yes'}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--mid)] hover:underline">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-500 text-red-500 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { icon: <Briefcase className="h-4 w-4" />, label: 'Open positions', value: dataLoading ? '…' : activeOpenings, sub: `${openings.length} total openings` },
          { icon: <Users className="h-4 w-4" />, label: 'Active placements', value: dataLoading ? '…' : activePlacements, sub: `${placements.length} total hires` },
          { icon: <TrendingUp className="h-4 w-4" />, label: 'Pipelines', value: dataLoading ? '…' : pipelines.length, sub: `${pipelines.filter(p => p.status === 'active').length} active` },
          { icon: <Users className="h-4 w-4" />, label: 'Portal users', value: orgUsers.length, sub: `${orgUsers.filter(u => u.status === 'active').length} active` },
        ].map(({ icon, label, value, sub }) => (
          <div key={label} className="rounded-2xl border border-[var(--border)] bg-white p-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--light)]">
              {icon}{label}
            </div>
            <p className="text-2xl font-800 tracking-tight text-[var(--black)]">{value}</p>
            <p className="mt-0.5 text-[10px] text-[var(--light)]">{sub}</p>
          </div>
        ))}
      </div>

      {/* Two-column content */}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Left: Package + Pipelines */}
        <div className="space-y-5">
          {/* Package card */}
          {pkg && (
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
              <div className="px-5 py-4" style={{ background: pkg.bg }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-700 uppercase tracking-wider" style={{ color: pkg.color }}>Current plan</p>
                    <p className="mt-0.5 text-xl font-800 tracking-tight" style={{ color: pkg.color }}>{pkg.label}</p>
                    <p className="text-xs" style={{ color: pkg.color, opacity: 0.8 }}>{pkg.tagline}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-800 tracking-tight" style={{ color: pkg.color }}>{pkg.price}</p>
                    <p className="text-xs" style={{ color: pkg.color, opacity: 0.7 }}>+ {pkg.fee} on placement</p>
                  </div>
                </div>
              </div>
              {org.contractStart && (
                <div className="flex gap-6 px-5 py-3 text-xs">
                  <div>
                    <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Contract start</p>
                    <p className="mt-0.5 font-500 text-[var(--black)]">{org.contractStart}</p>
                  </div>
                  {org.contractEnd && (
                    <div>
                      <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Contract end</p>
                      <p className="mt-0.5 font-500 text-[var(--black)]">{org.contractEnd}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Pipelines */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-4 text-sm font-700 text-[var(--black)]">
              Pipelines <span className="text-[var(--light)]">({pipelines.length})</span>
            </h3>
            {dataLoading ? (
              <div className="flex justify-center py-4"><Spinner size="sm" /></div>
            ) : pipelines.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--light)]">No pipelines yet for this org.</p>
            ) : (
              <div className="space-y-2">
                {pipelines.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-600 text-[var(--black)]">{p.title}</p>
                      <p className="text-[10px] text-[var(--light)]">
                        {p.code} · {p.candidates?.length ?? 0} candidates
                      </p>
                    </div>
                    <Badge label={p.status} variant="status" className="text-[9px]" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent placements */}
          {placements.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
              <h3 className="mb-4 text-sm font-700 text-[var(--black)]">
                Hires <span className="text-[var(--light)]">({placements.length})</span>
              </h3>
              <div className="space-y-2">
                {placements.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-700 text-white"
                      style={{ background: 'var(--green)' }}
                    >
                      {initials(p.candidateName ?? '?')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-600 text-[var(--black)]">{p.candidateName ?? '—'}</p>
                      <p className="text-[10px] text-[var(--light)]">
                        Started {p.startDate} · {p.salaryCurrency ?? 'USD'} {p.salaryAmount?.toLocaleString()}
                      </p>
                    </div>
                    <Badge label={p.status ?? 'active'} variant="status" className="text-[9px]" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Users */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-700 text-[var(--black)]">
              Client users <span className="text-[var(--light)]">({orgUsers.length})</span>
            </h3>
          </div>

          {/* Add user */}
          <div className="mb-4 flex gap-2">
            <input
              value={addUserEmail}
              onChange={(e) => setAddUserEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addUser()}
              placeholder="email@client.com"
              type="email"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
            />
            <button
              onClick={addUser}
              disabled={addingUser || !addUserEmail.trim()}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-600 text-white disabled:opacity-50"
              style={{ background: 'var(--green)' }}
            >
              {addingUser ? <Spinner size="sm" /> : <UserPlus className="h-3.5 w-3.5" />}
              Invite
            </button>
          </div>

          {orgUsers.length === 0 ? (
            <div className="rounded-xl bg-[var(--bg)] px-4 py-8 text-center">
              <p className="text-xs text-[var(--light)]">No users yet. Add one above to send an invite.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orgUsers.map((u) => (
                <div key={u.email} className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-700 text-white"
                    style={{ background: u.status === 'active' ? 'var(--green)' : '#9E9E9E' }}
                  >
                    {u.email.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-500 text-[var(--black)]">{u.email}</p>
                    <p className={`text-[10px] font-600 ${u.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {u.status === 'active' ? '● Active' : '○ Invited'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {u.status !== 'active' && (
                      <button
                        onClick={() => resendInvite(u.email)}
                        disabled={invitesSending.has(u.email)}
                        title="Resend invite"
                        className="rounded-md p-1.5 text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--green)]"
                      >
                        {invitesSending.has(u.email) ? <Spinner size="sm" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <button
                      onClick={() => removeUser(u.email)}
                      title="Remove user"
                      className="rounded-md p-1.5 text-[var(--light)] hover:bg-red-50 hover:text-red-500"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
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
