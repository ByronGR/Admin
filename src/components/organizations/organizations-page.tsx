'use client';

import { useState, useEffect, useRef } from 'react';
import {
  db,
  auth,
  collection,
  getDocs,
  getDoc,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  sendPasswordResetEmail,
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
import type {
  Organization, Pipeline, Placement, Opening, OrgPackage, OrgContractType, OrgUser,
  AccountHealthGrade, HealthHistoryEntry, OrgTier, OrgPOC, EngagementType, ClientAccount,
} from '@/lib/types';
import { ENGAGEMENT_LABELS } from '@/lib/types';
import {
  Search, Plus, Building2, ExternalLink, ChevronRight, X,
  Edit3, Trash2, Mail, UserPlus, UserMinus, RefreshCw,
  Link2, Camera, Briefcase, Trophy, Users, TrendingUp,
  AlertTriangle, Activity, History, DollarSign,
  Phone, Star, GitBranch, UserCog, Crown, Plus as PlusIcon,
  Network, Layers, Ban, Power, KeyRound, CheckCircle2,
} from 'lucide-react';

// Engagement-type colours (shared with the Hired module)
const ENGAGEMENT_STYLE: Record<EngagementType, { color: string; bg: string }> = {
  eor: { color: '#C0392B', bg: '#FEF0F0' },
  managed: { color: '#16A085', bg: '#E8F8F5' },
  spp: { color: '#D35400', bg: '#FEF5EB' },
  direct: { color: '#555555', bg: '#F5F5F5' },
};

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

// ─── Tier (spend-based, internal only — partner never sees this) ───────────────
// Future: totalSpend will be pulled from Stripe in real time. For now it's a manual
// field on the org; the tier is derived from it so the logic stays in one place.

const TIER_BANDS: { tier: OrgTier; min: number; label: string }[] = [
  { tier: 'A', min: 250000, label: '$250k+' },
  { tier: 'B', min: 100000, label: '$100k–249k' },
  { tier: 'C', min: 50000,  label: '$50k–99k' },
  { tier: 'D', min: 25000,  label: '$25k–49k' },
  { tier: 'E', min: 10000,  label: '$10k–24k' },
  { tier: 'F', min: 1,      label: '$1–9.9k' },
  { tier: 'Z', min: 0,      label: '$0' },
];

function getTier(spend?: number): { tier: OrgTier; label: string } {
  const s = spend ?? 0;
  for (const b of TIER_BANDS) if (s >= b.min) return { tier: b.tier, label: b.label };
  return { tier: 'Z', label: '$0' };
}

function fmtSpend(spend?: number): string {
  const s = spend ?? 0;
  if (s === 0) return '$0';
  if (s >= 1000) return `$${(s / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
  return `$${s.toLocaleString()}`;
}

function TierBadge({ spend }: { spend?: number }) {
  const t = getTier(spend);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[10px] font-700 text-[var(--mid)]"
      title={`Tier ${t.tier} · ${t.label} lifetime spend (internal)`}
    >
      <span className="font-800 text-[var(--black)]">Tier {t.tier}</span>
      <span className="text-[var(--light)]">{fmtSpend(spend)}</span>
    </span>
  );
}

// ─── Account Health (internal only — partner never sees this) ──────────────────
// A Excellent · B Healthy · C Stable/Watchlist · D At Risk · F Critical · Z Inactive

interface HealthInfo { grade: AccountHealthGrade; label: string; color: string; bg: string; }

const HEALTH: Record<AccountHealthGrade, HealthInfo> = {
  A: { grade: 'A', label: 'Excellent',            color: '#16A085', bg: '#E8F8F5' },
  B: { grade: 'B', label: 'Healthy',              color: '#27AE60', bg: '#EAFBF0' },
  C: { grade: 'C', label: 'Stable / Watchlist',   color: '#D68910', bg: '#FEF9E7' },
  D: { grade: 'D', label: 'At Risk',              color: '#E67E22', bg: '#FDF2E9' },
  F: { grade: 'F', label: 'Critical',             color: '#C0392B', bg: '#FDEDEC' },
  Z: { grade: 'Z', label: 'Inactive / No Signal', color: '#9E9E9E', bg: '#F5F5F5' },
};

function getHealth(grade?: AccountHealthGrade): HealthInfo {
  return HEALTH[grade ?? 'Z'];
}

const HEALTH_GRADES: AccountHealthGrade[] = ['A', 'B', 'C', 'D', 'F', 'Z'];

function HealthGrade({ grade, size = 'md' }: { grade?: AccountHealthGrade; size?: 'sm' | 'md' | 'lg' }) {
  const h = getHealth(grade);
  const sizes = {
    sm: 'h-9 w-9 text-base rounded-lg',
    md: 'h-12 w-12 text-xl rounded-xl',
    lg: 'h-20 w-20 text-5xl rounded-2xl',
  };
  return (
    <div
      className={`${sizes[size]} flex shrink-0 items-center justify-center font-800`}
      style={{ background: h.bg, color: h.color }}
      title={`Account Health: ${h.label}`}
    >
      {h.grade}
    </div>
  );
}

// ─── Resend invite ────────────────────────────────────────────────────────────

async function sendInviteEmail(
  email: string,
  orgId: string,
  orgName: string,
  details?: { firstName?: string; lastName?: string; jobTitle?: string }
): Promise<{ token: string; emailSent: boolean; stored: boolean }> {
  const token = crypto.randomUUID();
  const fallback = email.split('@')[0].split('.')[0];
  const emailName = fallback.charAt(0).toUpperCase() + fallback.slice(1);
  // The client now fills in their own name + role on the create-account screen, so
  // we only seed the link with name/title when explicitly provided. The email
  // greeting still uses a friendly email-derived name as a fallback.
  const providedFirst = details?.firstName?.trim() || '';
  const lastName = details?.lastName?.trim() || '';
  const jobTitle = details?.jobTitle?.trim() || '';
  const greetingName = providedFirst || emailName;
  const setupLink = `https://app.nearwork.co/join?token=${token}&email=${encodeURIComponent(email)}&orgId=${encodeURIComponent(orgId)}&orgName=${encodeURIComponent(orgName)}`
    + (providedFirst ? `&firstName=${encodeURIComponent(providedFirst)}` : '')
    + (lastName ? `&lastName=${encodeURIComponent(lastName)}` : '')
    + (jobTitle ? `&title=${encodeURIComponent(jobTitle)}` : '');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Store invite in Firestore — never throws, failures are logged only
  let stored = false;
  try {
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
    stored = true;
  } catch (e) {
    console.warn('[Nearwork] Could not store org_invite:', e);
  }

  // Send via our server-side API route (uses RESEND_API_KEY, never exposed to browser)
  try {
    const res = await fetch('/api/send-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, firstName: greetingName, orgName, setupLink }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[Nearwork] /api/send-invite failed:', err);
    }
    return { token, emailSent: res.ok, stored };
  } catch (e) {
    console.warn('[Nearwork] /api/send-invite fetch failed:', e);
    return { token, emailSent: false, stored };
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
      // Match by shortId first (new URLs), fall back to Firestore doc id (old URLs)
      const org = orgs.find((o) => o.shortId === id || o.id === id);
      if (org) selectOrg(org);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs]);

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'organizations'));
      // Spread data first, then override `id` with the Firestore doc ID so a
      // data field named `id` (e.g. a short-code like "TKQKCC") never shadows
      // the real document ID that Firestore operations (updateDoc, queries) need.
      setOrgs(snap.docs.map((d) => ({ ...d.data(), id: d.id } as Organization)));
    } catch {
      showToast('Failed to load organizations', 'error');
    } finally {
      setLoading(false);
    }
  }

  function selectOrg(org: Organization | null) {
    setSelected(org);
    if (org) {
      // Use shortId in URL so the ID in the header matches the shareable link
      const urlId = org.shortId ?? org.id;
      window.history.pushState(null, '', `/organizations?id=${urlId}`);
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

      // Close modal & refresh immediately — don't let invite delays block this
      setNewModal(false);
      setForm({ name: '', website: '', country: '', city: '', industry: '', package: '', contractType: '', hubspotLink: '', status: 'active', inviteEmail: '' });
      showToast('Organization created', 'success');
      await load();

      // Send invite in background (after modal closed)
      if (form.inviteEmail.trim()) {
        const inviteEmail = form.inviteEmail.trim();
        const orgName = form.name.trim();
        await updateDoc(doc(db, 'organizations', docRef.id), {
          orgUsers: [{ email: inviteEmail, status: 'invited', invitedAt: new Date().toISOString() }],
        });
        const { emailSent } = await sendInviteEmail(inviteEmail, docRef.id, orgName);
        showToast(
          emailSent ? `Invite email sent to ${inviteEmail} ✓` : 'User added — add NEXT_PUBLIC_RESEND_API_KEY in Vercel to send emails',
          emailSent ? 'success' : 'info',
        );
      }
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
            allOrgs={orgs}
            onSelectOrg={selectOrg}
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
                <div className="grid grid-cols-[auto_2fr_1fr_auto_auto_auto] items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)] px-5 py-3 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
                  <div className="w-12"></div>
                  <div>Organization</div>
                  <div>Package</div>
                  <div>Tier</div>
                  <div className="text-center">Health</div>
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
                        className="grid cursor-pointer grid-cols-[auto_2fr_1fr_auto_auto_auto] items-center gap-3 border-b border-[var(--border)] px-5 py-3.5 last:border-0 transition-colors hover:bg-[var(--bg)]"
                      >
                        <div className="w-12">
                          <OrgAvatar org={o} size="sm" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-600 text-[var(--black)]">{o.name}</p>
                            <Badge label={o.status ?? 'active'} variant={orgStatusVariant(o.status ?? 'active') as 'green' | 'amber' | 'red'} />
                            {o.actionNeeded && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-700 text-amber-700"
                                title={o.actionNote || 'Action needed'}
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Action needed
                              </span>
                            )}
                          </div>
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
                          <TierBadge spend={o.totalSpend} />
                        </div>
                        <div className="flex justify-center">
                          <HealthGrade grade={o.healthGrade} size="sm" />
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
  allOrgs,
  onSelectOrg,
  onClose,
  onRefresh,
  onUpdated,
}: {
  org: Organization;
  allOrgs: Organization[];
  onSelectOrg: (org: Organization) => void;
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
  const [fixingLinks, setFixingLinks] = useState(false);

  // UI state
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [suspending, setSuspending] = useState(false);
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
  // Real client accounts from the App's `users` collection (keyed by lowercase email)
  const [clientAccounts, setClientAccounts] = useState<Record<string, ClientAccount>>({});
  const [userActionBusy, setUserActionBusy] = useState<Set<string>>(new Set());
  // Update-position modal
  const [positionModal, setPositionModal] = useState(false);
  const [positionAccount, setPositionAccount] = useState<ClientAccount | null>(null);
  const [positionInput, setPositionInput] = useState('');
  const [savingPosition, setSavingPosition] = useState(false);

  // Account Health state
  const [healthModal, setHealthModal] = useState(false);
  const [healthGradePick, setHealthGradePick] = useState<AccountHealthGrade>(org.healthGrade ?? 'Z');
  const [healthNote, setHealthNote] = useState('');
  const [savingHealth, setSavingHealth] = useState(false);

  // Tier (spend) state
  const [spendModal, setSpendModal] = useState(false);
  const [spendInput, setSpendInput] = useState(String(org.totalSpend ?? 0));
  const [savingSpend, setSavingSpend] = useState(false);

  // Action-needed state
  const [savingAction, setSavingAction] = useState(false);

  // Detail tab navigation
  const [tab, setTab] = useState<'overview' | 'hiring' | 'team' | 'people'>('overview');

  // Openings/Pipelines view toggles
  const [showInactiveOpenings, setShowInactiveOpenings] = useState(false);
  const [showInactivePipelines, setShowInactivePipelines] = useState(false);

  // Nearwork staff state
  const [staffModal, setStaffModal] = useState(false);
  const [staffForm, setStaffForm] = useState({
    accountManager: org.accountManager ?? '',
    accountManagerEmail: org.accountManagerEmail ?? '',
    salesCloser: org.salesCloser ?? '',
    salesCloserEmail: org.salesCloserEmail ?? '',
    teamLead: org.teamLead ?? '',
    teamLeadEmail: org.teamLeadEmail ?? '',
  });
  const [savingStaff, setSavingStaff] = useState(false);
  const [staffUsers, setStaffUsers] = useState<{ name: string; email: string }[]>([]);

  // Load the Nearwork staff (anyone with an Admin account) so the staff modal can
  // offer a real dropdown instead of free text. Selecting a person captures both
  // their name and email, which then flow down to app.nearwork.co.
  useEffect(() => {
    getDocs(collection(db, 'users'))
      .then((snap) => {
        const staff = snap.docs
          .map((d) => d.data() as { name?: string; email?: string })
          .filter((u) => (u.email || '').toLowerCase().endsWith('@nearwork.co'))
          .map((u) => ({ name: u.name || u.email || '', email: (u.email || '').toLowerCase() }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setStaffUsers(staff);
      })
      .catch(() => null);
  }, []);

  // SPP / partnership state
  const [sppModal, setSppModal] = useState(false);
  const [sppForm, setSppForm] = useState({
    isStrategicPartner: org.isStrategicPartner ?? false,
    parentOrgId: org.parentOrgId ?? '',
  });
  const [savingSpp, setSavingSpp] = useState(false);

  // POC (decision-makers) state
  const [pocModal, setPocModal] = useState(false);
  const [pocList, setPocList] = useState<OrgPOC[]>(org.pocContacts ?? []);
  const [savingPoc, setSavingPoc] = useState(false);

  useEffect(() => {
    // Three-tier strategy so pipelines/openings always surface on the org page
    // regardless of how (or whether) `orgId` was written when the record was created:
    //
    // Tier 1 — exact orgId match: query with the Firestore doc ID (org.id) AND the
    //           human-readable short code (org.shortId) — whichever was stored.
    // Tier 2 — orgName fallback: if tier-1 returns nothing, query by `orgName` so
    //           records created before the orgId propagation fix are still visible.
    // Auto-heal: any doc found via tier-2 gets `orgId` written back so future
    //            queries hit tier-1 directly.

    const orgIds = [...new Set([org.id, org.shortId].filter(Boolean))] as string[];
    const collectionsToQuery = ['pipelines', 'placements', 'openings'] as const;

    const tier1Queries = orgIds.flatMap((oid) =>
      collectionsToQuery.map((col) =>
        getDocs(query(collection(db, col), where('orgId', '==', oid)))
      )
    );

    Promise.all(tier1Queries).then(async (snaps) => {
      const colCount = collectionsToQuery.length;
      const pipelineMap: Record<string, Pipeline> = {};
      const placementMap: Record<string, Placement> = {};
      const openingMap: Record<string, Opening> = {};

      const mergeDocs = (snapsSubset: typeof snaps) => {
        snapsSubset.forEach((snap, i) => {
          const colIdx = i % colCount;
          snap.docs.forEach((d) => {
            const item = { ...d.data(), id: d.id };
            if (colIdx === 0) pipelineMap[d.id]  = item as Pipeline;
            else if (colIdx === 1) placementMap[d.id] = item as Placement;
            else openingMap[d.id] = item as Opening;
          });
        });
      };

      mergeDocs(snaps);

      // Tier-2 fallback: if nothing matched by orgId, try orgName
      const foundSomething =
        Object.keys(pipelineMap).length > 0 ||
        Object.keys(placementMap).length > 0 ||
        Object.keys(openingMap).length > 0;

      if (!foundSomething && org.name) {
        const tier2Queries = collectionsToQuery.map((col) =>
          getDocs(query(collection(db, col), where('orgName', '==', org.name)))
        );
        const tier2Snaps = await Promise.all(tier2Queries);
        mergeDocs(tier2Snaps);

        // Auto-heal: stamp orgId on docs that were found via name fallback
        const healOrgId = org.id || org.shortId || '';
        if (healOrgId) {
          const allHealDocs = tier2Snaps.flatMap((snap) => snap.docs);
          allHealDocs.forEach((d) => {
            if (!d.data().orgId) {
              updateDoc(d.ref, { orgId: healOrgId }).catch(() => null);
            }
          });
        }
      }

      setPipelines(Object.values(pipelineMap));
      setPlacements(Object.values(placementMap));
      setOpenings(Object.values(openingMap));
      setDataLoading(false);
    }).catch(() => setDataLoading(false));
  }, [org.id, org.shortId, org.name]);

  // Load the real client accounts (App `users` docs) for this org so we can show
  // who has actually logged in vs. who is still just invited. Org membership is
  // stored under either `orgId` or `organizationId`, against the org's full id or
  // its short id, so we query all combinations and merge by email.
  async function loadClientAccounts() {
    const ids = [org.id, org.shortId].filter(Boolean) as string[];
    const fields = ['orgId', 'organizationId'];
    const queries = ids.flatMap((id) =>
      fields.map((f) => getDocs(query(collection(db, 'users'), where(f, '==', id))))
    );
    const results = await Promise.allSettled(queries);
    const map: Record<string, ClientAccount> = {};
    results.forEach((r) => {
      if (r.status !== 'fulfilled') return;
      r.value.docs.forEach((d) => {
        const data = d.data() as Omit<ClientAccount, 'id'>;
        const email = (data.email || '').toLowerCase();
        if (email) map[email] = { id: d.id, ...data, email };
      });
    });
    setClientAccounts(map);
  }

  useEffect(() => {
    loadClientAccounts().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id, org.shortId]);

  // One-click repair: search by orgName across all three collections and patch
  // in the correct orgId so subsequent queries work without manual Firestore edits.
  async function fixOrgLinks() {
    setFixingLinks(true);
    try {
      const healId = org.id || org.shortId || '';
      const cols = ['pipelines', 'placements', 'openings'] as const;
      const snaps = await Promise.all(
        cols.map((col) => getDocs(query(collection(db, col), where('orgName', '==', org.name))))
      );
      const patches: Promise<void>[] = [];
      const found: { col: string; id: string }[] = [];
      snaps.forEach((snap, i) => {
        snap.docs.forEach((d) => {
          found.push({ col: cols[i], id: d.id });
          if (healId && d.data().orgId !== healId) {
            patches.push(updateDoc(d.ref, { orgId: healId, orgName: org.name }));
          }
        });
      });
      await Promise.all(patches);
      // Reload hiring data after patching
      const reloaded = await Promise.all(
        cols.map((col) => getDocs(query(collection(db, col), where('orgId', '==', healId))))
      );
      const pipelineMap: Record<string, Pipeline> = {};
      const placementMap: Record<string, Placement> = {};
      const openingMap: Record<string, Opening> = {};
      reloaded.forEach((snap, i) => {
        snap.docs.forEach((d) => {
          const item = { ...d.data(), id: d.id };
          if (i === 0) pipelineMap[d.id] = item as Pipeline;
          else if (i === 1) placementMap[d.id] = item as Placement;
          else openingMap[d.id] = item as Opening;
        });
      });
      // Also merge in orgName-found docs (already patched above)
      snaps.forEach((snap, i) => {
        snap.docs.forEach((d) => {
          const item = { ...d.data(), id: d.id, orgId: healId };
          if (i === 0) pipelineMap[d.id] = item as Pipeline;
          else if (i === 1) placementMap[d.id] = item as Placement;
          else openingMap[d.id] = item as Opening;
        });
      });
      setPipelines(Object.values(pipelineMap));
      setPlacements(Object.values(placementMap));
      setOpenings(Object.values(openingMap));
      showToast(
        found.length > 0
          ? `Fixed ${patches.length} link${patches.length !== 1 ? 's' : ''} — found ${found.map((f) => f.id).join(', ')}`
          : 'No linked records found by org name. Check that pipeline/opening docs have orgName set.',
        found.length > 0 ? 'success' : 'error'
      );
    } catch (e) {
      showToast('Fix failed: ' + (e instanceof Error ? e.message : 'Unknown error'), 'error');
    } finally {
      setFixingLinks(false);
    }
  }

  const pkg = getPkg(org.package);
  const isOpeningActive = (o: Opening) => o.status === 'open' || o.status === 'paused';
  const isPipelineActive = (p: Pipeline) => p.status === 'active' || p.status === 'paused';
  const activeOpenings = openings.filter((o) => o.status === 'open').length;
  const activePlacements = placements.filter((p) => p.status === 'active').length;
  const shownOpenings = showInactiveOpenings ? openings : openings.filter(isOpeningActive);
  const shownPipelines = showInactivePipelines ? pipelines : pipelines.filter(isPipelineActive);
  const inactiveOpeningsCount = openings.filter((o) => !isOpeningActive(o)).length;
  const inactivePipelinesCount = pipelines.filter((p) => !isPipelineActive(p)).length;
  const orgUsers: OrgUser[] = org.orgUsers ?? [];

  // ── Managed Team breakdown (by engagement type) ──────────────────────────────
  const activeTeam = placements.filter((p) => (p.status ?? 'active') === 'active');
  const engagementCounts = (['eor', 'managed', 'spp', 'direct'] as EngagementType[]).map((type) => ({
    type,
    count: activeTeam.filter((p) => (p.engagementType ?? 'direct') === type).length,
  })).filter((e) => e.count > 0);

  // ── SPP / partnership relationships ──────────────────────────────────────────
  const childOrgs = allOrgs.filter((o) => o.parentOrgId === org.id);
  const parentOrg = org.parentOrgId ? allOrgs.find((o) => o.id === org.parentOrgId) ?? null : null;
  const partnershipSpend = (org.totalSpend ?? 0) + childOrgs.reduce((sum, o) => sum + (o.totalSpend ?? 0), 0);

  // ── Save Nearwork staff ──────────────────────────────────────────────────────

  async function saveStaff() {
    setSavingStaff(true);
    try {
      const data = {
        accountManager: staffForm.accountManager.trim() || null,
        accountManagerEmail: staffForm.accountManagerEmail.trim() || null,
        // app.nearwork.co reads these denormalized fields for the support card
        accountManagerName: staffForm.accountManager.trim() || null,
        salesCloser: staffForm.salesCloser.trim() || null,
        salesCloserEmail: staffForm.salesCloserEmail.trim() || null,
        teamLead: staffForm.teamLead.trim() || null,
        teamLeadEmail: staffForm.teamLeadEmail.trim() || null,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'organizations', org.id), data);
      onUpdated({
        ...org,
        accountManager: data.accountManager ?? undefined,
        accountManagerEmail: data.accountManagerEmail ?? undefined,
        salesCloser: data.salesCloser ?? undefined,
        salesCloserEmail: data.salesCloserEmail ?? undefined,
        teamLead: data.teamLead ?? undefined,
        teamLeadEmail: data.teamLeadEmail ?? undefined,
      });
      showToast('Nearwork staff updated', 'success');
      setStaffModal(false);
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSavingStaff(false);
    }
  }

  // ── Save SPP / partnership ────────────────────────────────────────────────────

  async function savePartnership() {
    setSavingSpp(true);
    try {
      const parent = sppForm.parentOrgId ? allOrgs.find((o) => o.id === sppForm.parentOrgId) : null;
      const data = {
        isStrategicPartner: sppForm.isStrategicPartner,
        parentOrgId: sppForm.parentOrgId || null,
        parentOrgName: parent?.name ?? null,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'organizations', org.id), data);
      onUpdated({
        ...org,
        isStrategicPartner: data.isStrategicPartner,
        parentOrgId: data.parentOrgId ?? undefined,
        parentOrgName: data.parentOrgName ?? undefined,
      });
      showToast('Partnership updated', 'success');
      setSppModal(false);
      await onRefresh();
    } catch {
      showToast('Failed to save partnership', 'error');
    } finally {
      setSavingSpp(false);
    }
  }

  // ── Save POC (decision-makers) ────────────────────────────────────────────────

  function addPocRow() {
    setPocList((l) => [...l, { id: genSafeId(), name: '', role: '', email: '', phone: '', isDecisionMaker: false }]);
  }
  function updatePocRow(id: string, patch: Partial<OrgPOC>) {
    setPocList((l) => l.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function removePocRow(id: string) {
    setPocList((l) => l.filter((p) => p.id !== id));
  }
  async function savePoc() {
    setSavingPoc(true);
    try {
      const clean = pocList
        .filter((p) => p.name.trim())
        .map((p) => ({
          id: p.id,
          name: p.name.trim(),
          role: p.role?.trim() || '',
          email: p.email?.trim() || '',
          phone: p.phone?.trim() || '',
          isDecisionMaker: !!p.isDecisionMaker,
        }));
      await updateDoc(doc(db, 'organizations', org.id), { pocContacts: clean, updatedAt: serverTimestamp() });
      onUpdated({ ...org, pocContacts: clean });
      setPocList(clean);
      showToast('Contacts updated', 'success');
      setPocModal(false);
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSavingPoc(false);
    }
  }

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
      // Cascade: remove every client profile tied to this org so deleting the
      // organization also revokes portal access for all of its users. We match on
      // both orgId and organizationId since profiles use either field.
      const orgKeys = [org.id, org.shortId].filter(Boolean) as string[];
      const userDocIds = new Set<string>();
      for (const field of ['orgId', 'organizationId']) {
        for (const key of orgKeys) {
          try {
            const snap = await getDocs(query(collection(db, 'users'), where(field, '==', key)));
            snap.docs.forEach((d) => userDocIds.add(d.id));
          } catch { /* ignore individual query failures */ }
        }
      }
      await Promise.allSettled([...userDocIds].map((id) => deleteDoc(doc(db, 'users', id))));
      await deleteDoc(doc(db, 'organizations', org.id));
      showToast(`Organization deleted — ${userDocIds.size} user${userDocIds.size === 1 ? '' : 's'} removed`, 'success');
      onClose();
      await onRefresh();
    } catch {
      showToast('Failed to delete', 'error');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  // Suspend / reactivate: flips organizations/{id}.status. The client portal watches
  // this field live and immediately logs out anyone currently signed in, and blocks
  // new logins with a "contact support" message until the org is reactivated.
  async function toggleSuspend() {
    const suspend = (org.status ?? 'active') !== 'suspended';
    setSuspending(true);
    try {
      await updateDoc(doc(db, 'organizations', org.id), {
        status: suspend ? 'suspended' : 'active',
        updatedAt: serverTimestamp(),
      });
      const updated = { ...org, status: (suspend ? 'suspended' : 'active') as Organization['status'] };
      onUpdated(updated);
      setEditForm((f) => ({ ...f, status: updated.status ?? 'active' }));
      showToast(suspend ? 'Organization suspended — users logged out' : 'Organization reactivated', 'success');
    } catch {
      showToast('Failed to update status', 'error');
    } finally {
      setSuspending(false);
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
      // Step 1: add user to org — this must succeed. Name + role are collected from
      // the client on the create-account screen, so we only store the email here.
      const newUser: OrgUser = { email, status: 'invited', invitedAt: new Date().toISOString() };
      const updatedUsers = [...orgUsers, newUser];
      await updateDoc(doc(db, 'organizations', org.id), { orgUsers: updatedUsers, updatedAt: serverTimestamp() });
      onUpdated({ ...org, orgUsers: updatedUsers });
      setAddUserEmail('');
      showToast('User added', 'success');
    } catch {
      showToast('Failed to add user', 'error');
      setAddingUser(false);
      return;
    }

    // Step 2: send invite — separate try/catch so it never blocks step 1
    try {
      const { emailSent } = await sendInviteEmail(email, org.id, org.name);
      if (emailSent) {
        showToast(`Invite email sent to ${email} ✓`, 'success');
      } else {
        showToast('User added — add NEXT_PUBLIC_RESEND_API_KEY in Vercel to send emails', 'info');
      }
    } catch {
      // invite failure is non-critical
    } finally {
      setAddingUser(false);
    }
  }

  // ── Per-user actions on real client accounts (item 5) ───────────────────────
  function markUserBusy(email: string, busy: boolean) {
    setUserActionBusy((s) => {
      const next = new Set(s);
      if (busy) next.add(email); else next.delete(email);
      return next;
    });
  }

  async function resetUserPassword(email: string) {
    markUserBusy(email, true);
    try {
      await sendPasswordResetEmail(auth, email);
      showToast(`Password reset email sent to ${email} ✓`, 'success');
    } catch {
      showToast('Could not send password reset email', 'error');
    } finally {
      markUserBusy(email, false);
    }
  }

  async function toggleUserSuspend(account: ClientAccount) {
    const suspend = !account.suspended;
    markUserBusy(account.email, true);
    try {
      await updateDoc(doc(db, 'users', account.id), { suspended: suspend, updatedAt: serverTimestamp() });
      setClientAccounts((m) => ({ ...m, [account.email]: { ...account, suspended: suspend } }));
      showToast(suspend ? `${account.email} suspended` : `${account.email} reactivated`, 'success');
    } catch {
      showToast('Could not update user', 'error');
    } finally {
      markUserBusy(account.email, false);
    }
  }

  function openPositionModal(account: ClientAccount) {
    setPositionAccount(account);
    setPositionInput(account.jobTitle || account.displayRole || '');
    setPositionModal(true);
  }

  async function saveUserPosition() {
    if (!positionAccount) return;
    const jobTitle = positionInput.trim();
    setSavingPosition(true);
    try {
      await updateDoc(doc(db, 'users', positionAccount.id), {
        jobTitle, displayRole: jobTitle, title: jobTitle, businessRole: jobTitle, updatedAt: serverTimestamp(),
      });
      setClientAccounts((m) => ({ ...m, [positionAccount.email]: { ...positionAccount, jobTitle, displayRole: jobTitle } }));
      // Mirror onto the org's invited list so the title persists there too.
      const updatedUsers = orgUsers.map((u) => u.email === positionAccount.email ? { ...u, jobTitle } : u);
      updateDoc(doc(db, 'organizations', org.id), { orgUsers: updatedUsers, updatedAt: serverTimestamp() })
        .then(() => onUpdated({ ...org, orgUsers: updatedUsers })).catch(() => null);
      showToast('Position updated ✓', 'success');
      setPositionModal(false);
    } catch {
      showToast('Could not update position', 'error');
    } finally {
      setSavingPosition(false);
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
      const { emailSent } = await sendInviteEmail(email, org.id, org.name);
      showToast(
        emailSent ? `Invite resent to ${email} ✓` : 'Invite stored — add NEXT_PUBLIC_RESEND_API_KEY in Vercel to send emails',
        emailSent ? 'success' : 'info',
      );
    } finally {
      setInvitesSending((s) => { const n = new Set(s); n.delete(email); return n; });
    }
  }

  // ── Account Health ───────────────────────────────────────────────────────────

  async function saveHealth() {
    const note = healthNote.trim();
    if (!note) { showToast('A note is required when changing health', 'error'); return; }
    setSavingHealth(true);
    try {
      const now = new Date().toISOString();
      const entry: HealthHistoryEntry = { grade: healthGradePick, note, at: now };
      const history = [entry, ...(org.healthHistory ?? [])];
      await updateDoc(doc(db, 'organizations', org.id), {
        healthGrade: healthGradePick,
        healthUpdatedAt: now,
        healthHistory: history,
        updatedAt: serverTimestamp(),
      });
      onUpdated({ ...org, healthGrade: healthGradePick, healthUpdatedAt: now, healthHistory: history });
      showToast('Account health updated', 'success');
      setHealthModal(false);
      setHealthNote('');
      await onRefresh();
    } catch {
      showToast('Failed to update health', 'error');
    } finally {
      setSavingHealth(false);
    }
  }

  // ── Tier / spend ─────────────────────────────────────────────────────────────

  async function saveSpend() {
    const value = Number(spendInput.replace(/[^0-9.]/g, ''));
    if (Number.isNaN(value) || value < 0) { showToast('Enter a valid amount', 'error'); return; }
    setSavingSpend(true);
    try {
      await updateDoc(doc(db, 'organizations', org.id), { totalSpend: value, updatedAt: serverTimestamp() });
      onUpdated({ ...org, totalSpend: value });
      showToast('Lifetime spend updated', 'success');
      setSpendModal(false);
      await onRefresh();
    } catch {
      showToast('Failed to update spend', 'error');
    } finally {
      setSavingSpend(false);
    }
  }

  // ── Action needed ────────────────────────────────────────────────────────────

  async function toggleActionNeeded() {
    const next = !org.actionNeeded;
    const note = next ? (window.prompt('What action is needed? (optional)') ?? '') : '';
    setSavingAction(true);
    try {
      await updateDoc(doc(db, 'organizations', org.id), {
        actionNeeded: next,
        actionNote: note,
        updatedAt: serverTimestamp(),
      });
      onUpdated({ ...org, actionNeeded: next, actionNote: note });
      showToast(next ? 'Flagged: action needed' : 'Action cleared', 'success');
      await onRefresh();
    } catch {
      showToast('Failed to update flag', 'error');
    } finally {
      setSavingAction(false);
    }
  }

  const health = getHealth(org.healthGrade);
  const tier = getTier(org.totalSpend);

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
                  <select value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as Organization['status'] ?? 'active' }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--green)]">
                    <option value="active">Active</option>
                    <option value="prospect">Prospect</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Contract type</label>
                  <select value={editForm.contractType} onChange={(e) => setEditForm((f) => ({ ...f, contractType: e.target.value as OrgContractType | '' }))}
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
              {(org.status ?? 'active') === 'suspended' ? (
                <button onClick={toggleSuspend} disabled={suspending}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-500 text-amber-700 hover:bg-amber-100 disabled:opacity-60">
                  <Power className="h-3.5 w-3.5" />{suspending ? 'Working…' : 'Reactivate'}
                </button>
              ) : (
                <button onClick={toggleSuspend} disabled={suspending}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-500 text-amber-600 hover:bg-amber-50 disabled:opacity-60">
                  <Ban className="h-3.5 w-3.5" />{suspending ? 'Working…' : 'Suspend'}
                </button>
              )}
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-500 text-red-600">Delete org + all its users?</span>
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

      {/* Account Intelligence — internal only (partner never sees this) */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
        {/* Account Health — big & proud */}
        <div className="rounded-2xl border bg-white p-5" style={{ borderColor: health.bg }}>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              <Activity className="h-3.5 w-3.5" />Account Health
            </div>
            <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[9px] font-600 text-[var(--light)]">Internal</span>
          </div>
          <div className="flex items-center gap-4">
            <HealthGrade grade={org.healthGrade} size="lg" />
            <div className="min-w-0">
              <p className="text-xl font-800 tracking-tight" style={{ color: health.color }}>{health.label}</p>
              <p className="mt-0.5 text-[11px] text-[var(--light)]">
                {org.healthUpdatedAt ? `Updated ${fmtDate(org.healthUpdatedAt)}` : 'Not yet set'}
              </p>
              <button
                onClick={() => { setHealthGradePick(org.healthGrade ?? 'Z'); setHealthNote(''); setHealthModal(true); }}
                className="mt-2 rounded-lg px-3 py-1.5 text-[11px] font-600 text-white"
                style={{ background: 'var(--green)' }}
              >
                Update health
              </button>
            </div>
          </div>
        </div>

        {/* Tier (spend) */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              <DollarSign className="h-3.5 w-3.5" />Tier
            </div>
            <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[9px] font-600 text-[var(--light)]">Internal</span>
          </div>
          <p className="text-3xl font-800 tracking-tight text-[var(--black)]">Tier {tier.tier}</p>
          <p className="mt-0.5 text-xs text-[var(--mid)]">{fmtSpend(org.totalSpend)} lifetime · {tier.label}</p>
          <button
            onClick={() => { setSpendInput(String(org.totalSpend ?? 0)); setSpendModal(true); }}
            className="mt-2 text-[11px] font-600 text-[var(--green)] hover:underline"
          >
            Edit spend
          </button>
        </div>

        {/* Action needed */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="mb-3 flex items-center gap-1.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
            <AlertTriangle className="h-3.5 w-3.5" />Action needed
          </div>
          {org.actionNeeded ? (
            <>
              <p className="text-sm font-700 text-amber-700">● Flagged</p>
              <p className="mt-1 line-clamp-2 text-[11px] text-[var(--mid)]">{org.actionNote || 'No detail provided'}</p>
            </>
          ) : (
            <p className="text-sm font-600 text-[var(--light)]">○ Clear</p>
          )}
          <button
            onClick={toggleActionNeeded}
            disabled={savingAction}
            className="mt-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)] disabled:opacity-50"
          >
            {org.actionNeeded ? 'Clear flag' : 'Flag action'}
          </button>
        </div>
      </div>

      {/* Health trend history */}
      {(org.healthHistory?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h3 className="mb-4 flex items-center gap-1.5 text-sm font-700 text-[var(--black)]">
            <History className="h-4 w-4 text-[var(--light)]" />Health trend
          </h3>
          <div className="space-y-3">
            {org.healthHistory!.map((h, i) => {
              const hi = getHealth(h.grade);
              return (
                <div key={`${h.at}-${i}`} className="flex gap-3">
                  <HealthGrade grade={h.grade} size="sm" />
                  <div className="min-w-0 flex-1 border-b border-[var(--border)] pb-3 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-700" style={{ color: hi.color }}>{hi.label}</span>
                      <span className="text-[10px] text-[var(--light)]">{fmtDate(h.at)}</span>
                      {h.by && <span className="text-[10px] text-[var(--light)]">· {h.by}</span>}
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--mid)]">{h.note}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { icon: <Briefcase className="h-4 w-4" />, label: 'Open positions', value: dataLoading ? '…' : activeOpenings, sub: `${openings.length} total openings` },
          { icon: <Users className="h-4 w-4" />, label: 'Active placements', value: dataLoading ? '…' : activePlacements, sub: `${placements.length} total hires` },
          { icon: <TrendingUp className="h-4 w-4" />, label: 'Pipelines', value: dataLoading ? '…' : pipelines.length, sub: `${pipelines.filter(p => p.status === 'active').length} active` },
          { icon: <Users className="h-4 w-4" />, label: 'Portal users', value: orgUsers.length, sub: `${orgUsers.filter(u => clientAccounts[u.email.toLowerCase()]).length} logged in` },
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

      {/* Tab nav */}
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
        {([['overview', 'Overview'], ['hiring', 'Hiring'], ['team', 'Team'], ['people', 'People']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative shrink-0 px-4 py-2.5 text-xs font-600 transition-colors ${tab === key ? 'text-[var(--green)]' : 'text-[var(--light)] hover:text-[var(--mid)]'}`}
          >
            {label}
            {tab === key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--green)]" />}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {tab === 'overview' && (
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {/* Package card */}
          {pkg ? (
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
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-6 text-center">
              <p className="text-xs text-[var(--light)]">No plan selected. Use Edit to assign a package.</p>
            </div>
          )}
        </div>

        {/* Overview right: quick facts */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-4 text-sm font-700 text-[var(--black)]">Quick facts</h3>
            <dl className="space-y-2.5 text-xs">
              {([
                ['Status', org.status ?? 'active'],
                ['Contract type', org.contractType ?? '—'],
                ['Industry', org.industry ?? '—'],
                ['Location', [org.city, org.country].filter(Boolean).join(', ') || '—'],
                ['Org ID', org.shortId ?? '—'],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--light)]">{k}</dt>
                  <dd className="truncate font-600 capitalize text-[var(--black)]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Partnership (SPP) */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-700 text-[var(--black)]">
                <Network className="h-4 w-4 text-[var(--green)]" />Partnership
              </h3>
              <button
                onClick={() => { setSppForm({ isStrategicPartner: org.isStrategicPartner ?? false, parentOrgId: org.parentOrgId ?? '' }); setSppModal(true); }}
                className="rounded-lg p-1.5 text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--green)]"
                title="Edit partnership"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            </div>

            {org.isStrategicPartner && (
              <div className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: ENGAGEMENT_STYLE.spp.bg }}>
                <Layers className="h-4 w-4" style={{ color: ENGAGEMENT_STYLE.spp.color }} />
                <span className="text-xs font-700" style={{ color: ENGAGEMENT_STYLE.spp.color }}>Strategic Partner</span>
              </div>
            )}

            {parentOrg ? (
              <button
                onClick={() => onSelectOrg(parentOrg)}
                className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-left transition-colors hover:border-[var(--green)] hover:bg-[var(--bg)]"
              >
                <OrgAvatar org={parentOrg} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Sub-client of</p>
                  <p className="truncate text-xs font-600 text-[var(--black)]">{parentOrg.name}</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--light)]" />
              </button>
            ) : org.isStrategicPartner ? (
              childOrgs.length === 0 ? (
                <p className="rounded-xl bg-[var(--bg)] px-4 py-5 text-center text-xs text-[var(--light)]">
                  No sub-clients yet. Open a sub-client org and set this org as its parent.
                </p>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between rounded-xl bg-[var(--bg)] px-3 py-2 text-xs">
                    <span className="text-[var(--light)]">{childOrgs.length} sub-client{childOrgs.length !== 1 ? 's' : ''}</span>
                    <span className="font-700 text-[var(--black)]">{fmtSpend(partnershipSpend)} combined</span>
                  </div>
                  <div className="space-y-2">
                    {childOrgs.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => onSelectOrg(c)}
                        className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] p-2.5 text-left transition-colors hover:border-[var(--green)] hover:bg-[var(--bg)]"
                      >
                        <OrgAvatar org={c} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-600 text-[var(--black)]">{c.name}</p>
                          <p className="text-[10px] text-[var(--light)]">{fmtSpend(c.totalSpend)} lifetime</p>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--light)]" />
                      </button>
                    ))}
                  </div>
                </>
              )
            ) : (
              <p className="rounded-xl bg-[var(--bg)] px-4 py-5 text-center text-xs text-[var(--light)]">
                Standalone org. Mark as a Strategic Partner or link it under a parent.
              </p>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ── Hiring tab ── */}
      {tab === 'hiring' && (
      <div className="space-y-5">
          {/* Openings */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-700 text-[var(--black)]">
                <Briefcase className="h-4 w-4 text-[var(--green)]" />
                Openings
                <span className="text-[var(--light)]">({activeOpenings} active)</span>
              </h3>
              <div className="flex items-center gap-2">
                {inactiveOpeningsCount > 0 && (
                  <button
                    onClick={() => setShowInactiveOpenings((v) => !v)}
                    className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
                  >
                    {showInactiveOpenings ? 'Hide' : 'Show'} inactive ({inactiveOpeningsCount})
                  </button>
                )}
                <a
                  href={`/openings?org=${org.id}`}
                  className="flex items-center gap-1 text-[10px] font-600 text-[var(--green)] hover:underline"
                >
                  View all <ChevronRight className="h-3 w-3" />
                </a>
              </div>
            </div>
            {dataLoading ? (
              <div className="flex justify-center py-4"><Spinner size="sm" /></div>
            ) : shownOpenings.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-xs text-[var(--light)]">
                  {openings.length === 0 ? 'No openings yet for this org.' : 'No active openings.'}
                </p>
                {openings.length === 0 && (
                  <button
                    onClick={fixOrgLinks}
                    disabled={fixingLinks}
                    className="mt-2 rounded-full border border-[var(--border)] px-3 py-1 text-[10px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)] disabled:opacity-50"
                  >
                    {fixingLinks ? 'Fixing…' : 'Fix links'}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {shownOpenings.map((o) => (
                  <a
                    key={o.id}
                    href={`/openings?id=${o.id}`}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 transition-colors hover:border-[var(--green)] hover:bg-[var(--bg)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-600 text-[var(--black)]">{o.title}</p>
                      <p className="text-[10px] text-[var(--light)]">
                        {o.department || o.type?.replace('_', ' ') || 'Role'}
                        {typeof o.applicationCount === 'number' ? ` · ${o.applicationCount} applicants` : ''}
                      </p>
                    </div>
                    <Badge label={o.status} variant="status" className="text-[9px]" />
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--light)]" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Pipelines */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-700 text-[var(--black)]">
                <GitBranch className="h-4 w-4 text-[var(--green)]" />
                Pipelines
                <span className="text-[var(--light)]">({pipelines.filter(isPipelineActive).length} active)</span>
              </h3>
              <div className="flex items-center gap-2">
                {inactivePipelinesCount > 0 && (
                  <button
                    onClick={() => setShowInactivePipelines((v) => !v)}
                    className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
                  >
                    {showInactivePipelines ? 'Hide' : 'Show'} inactive ({inactivePipelinesCount})
                  </button>
                )}
                <a
                  href={`/pipeline?org=${org.id}`}
                  className="flex items-center gap-1 text-[10px] font-600 text-[var(--green)] hover:underline"
                >
                  View all <ChevronRight className="h-3 w-3" />
                </a>
              </div>
            </div>
            {dataLoading ? (
              <div className="flex justify-center py-4"><Spinner size="sm" /></div>
            ) : shownPipelines.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-xs text-[var(--light)]">
                  {pipelines.length === 0 ? 'No pipelines yet for this org.' : 'No active pipelines.'}
                </p>
                {pipelines.length === 0 && (
                  <button
                    onClick={fixOrgLinks}
                    disabled={fixingLinks}
                    className="mt-2 rounded-full border border-[var(--border)] px-3 py-1 text-[10px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)] disabled:opacity-50"
                  >
                    {fixingLinks ? 'Fixing…' : 'Fix links'}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {shownPipelines.map((p) => (
                  <a
                    key={p.id}
                    href={`/pipeline?id=${p.id}`}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 transition-colors hover:border-[var(--green)] hover:bg-[var(--bg)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-600 text-[var(--black)]">{p.title}</p>
                      <p className="text-[10px] text-[var(--light)]">
                        {p.code} · {p.candidates?.length ?? 0} candidates
                      </p>
                    </div>
                    <Badge label={p.status} variant="status" className="text-[9px]" />
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--light)]" />
                  </a>
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
                  <a
                    key={p.id}
                    href={`/hired/${p.id}`}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 transition-colors hover:border-[var(--green)] hover:bg-[var(--bg)]"
                  >
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
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--light)]" />
                  </a>
                ))}
              </div>
            </div>
          )}
      </div>
      )}

      {/* ── Team tab ── */}
      {tab === 'team' && (
      <div className="space-y-5">
        {/* Team summary */}
        <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
          {/* Headcount + team lead */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-700 text-[var(--black)]">
                <Users className="h-4 w-4 text-[var(--green)]" />Managed team
              </h3>
              <button
                onClick={() => { setStaffForm({ accountManager: org.accountManager ?? '', accountManagerEmail: org.accountManagerEmail ?? '', salesCloser: org.salesCloser ?? '', salesCloserEmail: org.salesCloserEmail ?? '', teamLead: org.teamLead ?? '', teamLeadEmail: org.teamLeadEmail ?? '' }); setStaffModal(true); }}
                className="rounded-lg p-1.5 text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--green)]"
                title="Edit team lead"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-3xl font-800 tracking-tight text-[var(--black)]">{activeTeam.length}</p>
            <p className="mt-0.5 text-xs text-[var(--mid)]">active team member{activeTeam.length !== 1 ? 's' : ''}</p>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white" style={{ background: 'var(--green)' }}>
                <Crown className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Team lead</p>
                <p className="truncate text-xs font-600 text-[var(--black)]">{org.teamLead || <span className="font-400 text-[var(--light)]">Unassigned</span>}</p>
              </div>
            </div>
          </div>

          {/* Engagement breakdown */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-700 text-[var(--black)]">
              <Layers className="h-4 w-4 text-[var(--green)]" />Engagement mix
            </h3>
            {engagementCounts.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--light)]">No active team members to break down.</p>
            ) : (
              <div className="space-y-3">
                {engagementCounts.map(({ type, count }) => {
                  const s = ENGAGEMENT_STYLE[type];
                  const pct = Math.round((count / activeTeam.length) * 100);
                  return (
                    <div key={type}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-600" style={{ color: s.color }}>{ENGAGEMENT_LABELS[type]}</span>
                        <span className="text-[var(--light)]">{count} · {pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: s.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Team roster */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h3 className="mb-4 text-sm font-700 text-[var(--black)]">
            Roster <span className="text-[var(--light)]">({activeTeam.length} active)</span>
          </h3>
          {dataLoading ? (
            <div className="flex justify-center py-4"><Spinner size="sm" /></div>
          ) : activeTeam.length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--light)]">No active team members for this org.</p>
          ) : (
            <div className="space-y-2">
              {activeTeam.map((p) => {
                const eng = p.engagementType ?? 'direct';
                const s = ENGAGEMENT_STYLE[eng];
                return (
                  <a
                    key={p.id}
                    href={`/hired/${p.id}`}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 transition-colors hover:border-[var(--green)] hover:bg-[var(--bg)]"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-700 text-white" style={{ background: 'var(--green)' }}>
                      {initials(p.candidateName ?? '?')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-600 text-[var(--black)]">{p.candidateName ?? '—'}</p>
                      <p className="truncate text-[10px] text-[var(--light)]">{p.openingTitle ?? 'Contractor'} · since {p.startDate}</p>
                    </div>
                    <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-700" style={{ color: s.color, background: s.bg }}>
                      {ENGAGEMENT_LABELS[eng]}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--light)]" />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── People tab ── */}
      {tab === 'people' && (
      <div className="grid gap-5 items-start lg:grid-cols-2">
        {/* Nearwork staff */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-700 text-[var(--black)]">
              <UserCog className="h-4 w-4 text-[var(--green)]" />Nearwork staff
            </h3>
            <button
              onClick={() => { setStaffForm({ accountManager: org.accountManager ?? '', accountManagerEmail: org.accountManagerEmail ?? '', salesCloser: org.salesCloser ?? '', salesCloserEmail: org.salesCloserEmail ?? '', teamLead: org.teamLead ?? '', teamLeadEmail: org.teamLeadEmail ?? '' }); setStaffModal(true); }}
              className="rounded-lg p-1.5 text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--green)]"
              title="Edit Nearwork staff"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: 'var(--green)' }}>
                <Crown className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Account Manager</p>
                <p className="truncate text-xs font-600 text-[var(--black)]">{org.accountManager || <span className="font-400 text-[var(--light)]">Unassigned</span>}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--mid)]" style={{ background: 'var(--bg)' }}>
                <Star className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Sales closer</p>
                <p className="truncate text-xs font-600 text-[var(--black)]">{org.salesCloser || <span className="font-400 text-[var(--light)]">Not recorded</span>}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Decision-makers (POC) */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-700 text-[var(--black)]">
              <Users className="h-4 w-4 text-[var(--green)]" />Decision-makers
              <span className="text-[var(--light)]">({(org.pocContacts ?? []).length})</span>
            </h3>
            <button
              onClick={() => { setPocList(org.pocContacts ?? []); setPocModal(true); }}
              className="rounded-lg p-1.5 text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--green)]"
              title="Edit contacts"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
          </div>
          {(org.pocContacts ?? []).length === 0 ? (
            <div className="rounded-xl bg-[var(--bg)] px-4 py-6 text-center">
              <p className="text-xs text-[var(--light)]">No contacts yet. Add who makes decisions on the client side.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(org.pocContacts ?? []).map((c) => (
                <div key={c.id} className="rounded-xl border border-[var(--border)] p-3">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-600 text-[var(--black)]">{c.name}</p>
                    {c.isDecisionMaker && (
                      <span className="rounded-full bg-[var(--green)]/10 px-2 py-0.5 text-[9px] font-700 text-[var(--green)]">Decision-maker</span>
                    )}
                  </div>
                  {c.role && <p className="text-[10px] text-[var(--light)]">{c.role}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-[10px] font-500 text-[var(--mid)] hover:text-[var(--green)]">
                        <Mail className="h-3 w-3" />{c.email}
                      </a>
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-[10px] font-500 text-[var(--mid)] hover:text-[var(--green)]">
                        <Phone className="h-3 w-3" />{c.phone}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Client users */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-700 text-[var(--black)]">
              Client users <span className="text-[var(--light)]">({orgUsers.length})</span>
            </h3>
          </div>

          {/* Add user — just an email; the client fills in their name + role on signup */}
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
              {orgUsers.map((u) => {
                const account = clientAccounts[u.email.toLowerCase()];
                const loggedIn = !!account;
                const suspended = !!account?.suspended;
                const displayName = account?.name || u.name
                  || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
                const title = account?.jobTitle || account?.displayRole || u.jobTitle || '';
                const busy = userActionBusy.has(u.email);
                const last = account?.lastLoginAt;
                const lastMs = typeof last === 'object' && last && 'seconds' in last
                  ? last.seconds * 1000 : (typeof last === 'string' ? Date.parse(last) : NaN);
                const lastStr = Number.isFinite(lastMs) ? fmtDate(new Date(lastMs).toISOString()) : '';
                const dotColor = suspended ? '#DC2626' : loggedIn ? 'var(--green)' : '#9E9E9E';
                return (
                <div key={u.email} className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-700 text-white"
                    style={{ background: dotColor }}
                  >
                    {(displayName || u.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-500 text-[var(--black)]">
                      {displayName}{title ? <span className="font-400 text-[var(--light)]"> · {title}</span> : null}
                    </p>
                    <p className="truncate text-[10px] text-[var(--light)]">{u.email}</p>
                    <p className={`text-[10px] font-600 ${suspended ? 'text-red-600' : loggedIn ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {suspended
                        ? '● Suspended'
                        : loggedIn
                          ? `● Logged in${lastStr ? ` · ${lastStr}` : ''}`
                          : '○ Invited'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {loggedIn ? (
                      <>
                        <button
                          onClick={() => openPositionModal(account)}
                          title="Update position"
                          className="rounded-md p-1.5 text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--green)]"
                        >
                          <Briefcase className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => resetUserPassword(u.email)}
                          disabled={busy}
                          title="Send password reset email"
                          className="rounded-md p-1.5 text-[var(--light)] hover:bg-[var(--bg)] hover:text-[var(--green)] disabled:opacity-50"
                        >
                          {busy ? <Spinner size="sm" /> : <KeyRound className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => toggleUserSuspend(account)}
                          disabled={busy}
                          title={suspended ? 'Reactivate user' : 'Suspend user'}
                          className={`rounded-md p-1.5 disabled:opacity-50 ${suspended ? 'text-emerald-600 hover:bg-emerald-50' : 'text-[var(--light)] hover:bg-amber-50 hover:text-amber-600'}`}
                        >
                          {suspended ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                        </button>
                      </>
                    ) : (
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
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Update health modal */}
      <Modal open={healthModal} onClose={() => setHealthModal(false)} title="Update Account Health" size="md">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Grade</label>
            <div className="flex flex-wrap gap-2">
              {HEALTH_GRADES.map((g) => {
                const hi = HEALTH[g];
                const isSel = healthGradePick === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setHealthGradePick(g)}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all"
                    style={isSel
                      ? { borderColor: hi.color, background: hi.bg }
                      : { borderColor: 'var(--border)' }}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-800" style={{ background: hi.bg, color: hi.color }}>{g}</span>
                    <span className="text-[11px] font-600" style={{ color: isSel ? hi.color : 'var(--mid)' }}>{hi.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              Why this grade? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={healthNote}
              onChange={(e) => setHealthNote(e.target.value)}
              rows={3}
              placeholder="e.g. Pipeline stalled 3 weeks, client unresponsive on 2 open roles…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
            <p className="mt-1 text-[10px] text-[var(--light)]">A note is required every time health changes — it builds the trend history.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveHealth}
              disabled={savingHealth || !healthNote.trim()}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-50"
              style={{ background: 'var(--green)' }}
            >
              {savingHealth && <Spinner size="sm" />}Save health
            </button>
            <button onClick={() => setHealthModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Edit spend modal */}
      <Modal open={spendModal} onClose={() => setSpendModal(false)} title="Lifetime spend" size="sm">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Total spend (USD)</label>
            <input
              value={spendInput}
              onChange={(e) => setSpendInput(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
            <p className="mt-1 text-[10px] text-[var(--light)]">
              Tier {getTier(Number(spendInput.replace(/[^0-9.]/g, '')) || 0).tier} · {getTier(Number(spendInput.replace(/[^0-9.]/g, '')) || 0).label}. Later this will sync from Stripe automatically.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveSpend}
              disabled={savingSpend}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-50"
              style={{ background: 'var(--green)' }}
            >
              {savingSpend && <Spinner size="sm" />}Save
            </button>
            <button onClick={() => setSpendModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Update position modal */}
      <Modal open={positionModal} onClose={() => setPositionModal(false)} title="Update position" size="sm">
        <div className="space-y-4">
          {positionAccount && (
            <p className="text-xs text-[var(--light)]">
              Set the job title shown to <span className="font-600 text-[var(--black)]">{positionAccount.name || positionAccount.email}</span> in their portal.
            </p>
          )}
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Job title</label>
            <input
              value={positionInput}
              onChange={(e) => setPositionInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveUserPosition()}
              placeholder="e.g. CEO, Hiring Manager"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveUserPosition}
              disabled={savingPosition}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-50"
              style={{ background: 'var(--green)' }}
            >
              {savingPosition && <Spinner size="sm" />}Save
            </button>
            <button onClick={() => setPositionModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Nearwork staff modal */}
      <Modal open={staffModal} onClose={() => setStaffModal(false)} title="Nearwork staff" size="sm">
        <div className="space-y-4">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              <Crown className="h-3 w-3" />Account Manager
            </label>
            <select
              value={staffForm.accountManagerEmail || (staffForm.accountManager ? '__legacy__' : '')}
              onChange={(e) => {
                const picked = staffUsers.find((u) => u.email === e.target.value);
                setStaffForm((f) => ({ ...f, accountManager: picked?.name ?? '', accountManagerEmail: picked?.email ?? '' }));
              }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            >
              <option value="">Unassigned</option>
              {staffForm.accountManager && !staffForm.accountManagerEmail && (
                <option value="__legacy__">{staffForm.accountManager} (no email on file)</option>
              )}
              {staffUsers.map((u) => (
                <option key={u.email} value={u.email}>{u.name} — {u.email}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-[var(--light)]">Shown to the client in app.nearwork.co.</p>
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              <Star className="h-3 w-3" />Sales closer
            </label>
            <select
              value={staffForm.salesCloserEmail || (staffForm.salesCloser ? '__legacy__' : '')}
              onChange={(e) => {
                const picked = staffUsers.find((u) => u.email === e.target.value);
                setStaffForm((f) => ({ ...f, salesCloser: picked?.name ?? '', salesCloserEmail: picked?.email ?? '' }));
              }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            >
              <option value="">Unassigned</option>
              {staffForm.salesCloser && !staffForm.salesCloserEmail && (
                <option value="__legacy__">{staffForm.salesCloser} (no email on file)</option>
              )}
              {staffUsers.map((u) => (
                <option key={u.email} value={u.email}>{u.name} — {u.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              <Users className="h-3 w-3" />Team lead
            </label>
            <select
              value={staffForm.teamLeadEmail || (staffForm.teamLead ? '__legacy__' : '')}
              onChange={(e) => {
                const picked = staffUsers.find((u) => u.email === e.target.value);
                setStaffForm((f) => ({ ...f, teamLead: picked?.name ?? '', teamLeadEmail: picked?.email ?? '' }));
              }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            >
              <option value="">Unassigned</option>
              {staffForm.teamLead && !staffForm.teamLeadEmail && (
                <option value="__legacy__">{staffForm.teamLead} (no email on file)</option>
              )}
              {staffUsers.map((u) => (
                <option key={u.email} value={u.email}>{u.name} — {u.email}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveStaff}
              disabled={savingStaff}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-50"
              style={{ background: 'var(--green)' }}
            >
              {savingStaff && <Spinner size="sm" />}Save
            </button>
            <button onClick={() => setStaffModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Partnership (SPP) modal */}
      <Modal open={sppModal} onClose={() => setSppModal(false)} title="Partnership (SPP)" size="md">
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] p-3 hover:border-[var(--green)]">
            <input
              type="checkbox"
              checked={sppForm.isStrategicPartner}
              onChange={(e) => setSppForm((f) => ({ ...f, isStrategicPartner: e.target.checked }))}
              className="mt-0.5 h-4 w-4 accent-[var(--green)]"
            />
            <div>
              <p className="flex items-center gap-1.5 text-xs font-700 text-[var(--black)]">
                <Layers className="h-3.5 w-3.5" style={{ color: ENGAGEMENT_STYLE.spp.color }} />Strategic Partner
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--light)]">
                This org is an SPP parent — other orgs can be linked beneath it as sub-clients, and their spend rolls up here.
              </p>
            </div>
          </label>

          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Parent organization (sub-client of)</label>
            <select
              value={sppForm.parentOrgId}
              onChange={(e) => setSppForm((f) => ({ ...f, parentOrgId: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            >
              <option value="">None (standalone)</option>
              {allOrgs
                .filter((o) => o.id !== org.id && o.parentOrgId !== org.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
            </select>
            <p className="mt-1 text-[10px] text-[var(--light)]">Link this org under a Strategic Partner parent. Leave as standalone if it has no parent.</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={savePartnership}
              disabled={savingSpp}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-50"
              style={{ background: 'var(--green)' }}
            >
              {savingSpp && <Spinner size="sm" />}Save partnership
            </button>
            <button onClick={() => setSppModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Decision-makers (POC) modal */}
      <Modal open={pocModal} onClose={() => setPocModal(false)} title="Decision-makers" size="lg">
        <div className="space-y-4">
          {pocList.length === 0 ? (
            <p className="rounded-xl bg-[var(--bg)] px-4 py-6 text-center text-xs text-[var(--light)]">
              No contacts yet. Add the people who make decisions on the client side.
            </p>
          ) : (
            <div className="space-y-3">
              {pocList.map((c) => (
                <div key={c.id} className="rounded-xl border border-[var(--border)] p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={c.name}
                      onChange={(e) => updatePocRow(c.id, { name: e.target.value })}
                      placeholder="Full name"
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)] focus:bg-white"
                    />
                    <input
                      value={c.role ?? ''}
                      onChange={(e) => updatePocRow(c.id, { role: e.target.value })}
                      placeholder="Role / title"
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)] focus:bg-white"
                    />
                    <input
                      value={c.email ?? ''}
                      onChange={(e) => updatePocRow(c.id, { email: e.target.value })}
                      placeholder="Email"
                      type="email"
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)] focus:bg-white"
                    />
                    <input
                      value={c.phone ?? ''}
                      onChange={(e) => updatePocRow(c.id, { phone: e.target.value })}
                      placeholder="Phone"
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)] focus:bg-white"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-500 text-[var(--mid)]">
                      <input
                        type="checkbox"
                        checked={!!c.isDecisionMaker}
                        onChange={(e) => updatePocRow(c.id, { isDecisionMaker: e.target.checked })}
                        className="h-3.5 w-3.5 accent-[var(--green)]"
                      />
                      Decision-maker
                    </label>
                    <button
                      onClick={() => removePocRow(c.id)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-600 text-[var(--light)] hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={addPocRow}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-4 py-2.5 text-xs font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
          >
            <PlusIcon className="h-3.5 w-3.5" />Add contact
          </button>
          <div className="flex gap-2">
            <button
              onClick={savePoc}
              disabled={savingPoc}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-50"
              style={{ background: 'var(--green)' }}
            >
              {savingPoc && <Spinner size="sm" />}Save contacts
            </button>
            <button onClick={() => setPocModal(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
