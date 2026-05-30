'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
  query,
  where,
  isNearworkEmail,
  HARD_CODED_SUPER_ADMINS,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/use-auth';
import { fmtDate, initials } from '@/lib/utils';
import type { UserProfile, StaffInvite, StaffRole } from '@/lib/types';
import { STAFF_ROLE_LABELS } from '@/lib/types';
import { Search, Plus, Mail, UserX, UserCheck, Copy, Check } from 'lucide-react';

// ─── Role badge colors ────────────────────────────────────────────────────────

function roleBadgeVariant(role: StaffRole): 'green' | 'amber' | 'blue' | 'neutral' {
  if (role === 'super_admin' || role === 'admin') return 'green';
  if (role === 'recruiter') return 'blue';
  if (role === 'sales') return 'amber';
  return 'neutral';
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { showToast } = useToast();
  const { user: currentUser, profile: currentProfile } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedMember, setSelectedMember] = useState<UserProfile | null>(null);

  // Invite modal
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'recruiter' as StaffRole });
  const [inviting, setInviting] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [usersSnap, invitesSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(query(collection(db, 'staffInvites'), where('status', '==', 'pending'))),
      ]);
      // Team = Nearwork staff only (the shared `users` collection also holds
      // client/partner accounts, which must not appear here).
      const staff = usersSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as UserProfile))
        .filter((u) => isNearworkEmail(u.email ?? ''));
      setUsers(staff);
      setInvites(invitesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffInvite)));
    } catch {
      showToast('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }

  const isSuperAdmin = currentProfile?.role === 'super_admin';

  // Always surface the signed-in user and the hardcoded super admins, even if
  // their Firestore `users` doc doesn't exist yet (e.g. never logged into Admin).
  const staffMembers = useMemo(() => {
    const byEmail = new Map<string, UserProfile>();
    for (const u of users) {
      const e = (u.email ?? '').toLowerCase();
      if (e) byEmail.set(e, u);
    }
    if (currentProfile?.email) {
      const e = currentProfile.email.toLowerCase();
      if (!byEmail.has(e)) {
        byEmail.set(e, {
          ...currentProfile,
          id: currentUser?.uid ?? currentProfile.id ?? e,
        } as UserProfile);
      }
    }
    for (const email of HARD_CODED_SUPER_ADMINS) {
      const e = email.toLowerCase();
      const existing = byEmail.get(e);
      if (!existing) {
        const name = e
          .split('@')[0]
          .split('.')
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
          .join(' ');
        byEmail.set(e, {
          id: `sa:${e}`,
          email: e,
          name,
          role: 'super_admin',
          staffRole: 'super_admin',
          status: 'active',
        } as UserProfile);
      } else {
        // Hardcoded super admins are always super_admin regardless of doc value
        byEmail.set(e, { ...existing, role: 'super_admin', staffRole: 'super_admin' });
      }
    }
    return Array.from(byEmail.values()).sort((a, b) =>
      (a.name ?? '').localeCompare(b.name ?? '')
    );
  }, [users, currentProfile, currentUser]);

  const filtered = staffMembers.filter((u) => {
    const q = search.toLowerCase();
    const matchSearch = !q || [u.name, u.email].join(' ').toLowerCase().includes(q);
    const matchRole = !roleFilter || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  async function sendInvite() {
    const email = inviteForm.email.trim().toLowerCase();
    if (!email) {
      showToast('Email is required', 'error');
      return;
    }
    if (!email.endsWith('@nearwork.co')) {
      showToast('Only @nearwork.co email addresses can be invited', 'error');
      return;
    }
    setInviting(true);
    try {
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await addDoc(collection(db, 'staffInvites'), {
        email,
        role: inviteForm.role,
        invitedBy: currentUser?.uid ?? '',
        invitedByEmail: currentUser?.email ?? '',
        status: 'pending',
        token,
        expiresAt,
        createdAt: serverTimestamp(),
      });

      const link = `${window.location.origin}/join?token=${token}`;
      setGeneratedLink(link);
      showToast('Invite created — share the link below', 'success');
      load();
    } catch {
      showToast('Failed to create invite', 'error');
    } finally {
      setInviting(false);
    }
  }

  async function toggleSuspend(user: UserProfile) {
    if (!isSuperAdmin && user.id === currentUser?.uid) return;
    const newStatus = user.status === 'suspended' ? 'active' : 'suspended';
    try {
      await updateDoc(doc(db, 'users', user.id), { status: newStatus, updatedAt: serverTimestamp() });
      showToast(`User ${newStatus === 'suspended' ? 'suspended' : 'reactivated'}`, 'success');
      load();
    } catch {
      showToast('Failed to update user', 'error');
    }
  }

  async function changeRole(userId: string, role: StaffRole) {
    try {
      await updateDoc(doc(db, 'users', userId), { role, staffRole: role, updatedAt: serverTimestamp() });
      showToast('Role updated', 'success');
      load();
    } catch {
      showToast('Failed to update role', 'error');
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(generatedLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function closeInviteModal() {
    setInviteModal(false);
    setInviteForm({ email: '', role: 'recruiter' });
    setGeneratedLink('');
  }

  return (
    <MainLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">Team</h1>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              {staffMembers.length} staff member{staffMembers.length !== 1 ? 's' : ''} · invite-only access
            </p>
          </div>
          {isSuperAdmin && (
            <button
              onClick={() => setInviteModal(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
              style={{ background: 'var(--green)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              Invite member
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--light)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team..."
              className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-[var(--green)]"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
          >
            <option value="">All roles</option>
            {(Object.keys(STAFF_ROLE_LABELS) as StaffRole[]).map((r) => (
              <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>

        {/* Users table */}
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            <div className="grid grid-cols-[auto_2fr_1fr_1fr_1fr] gap-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">
              <div className="w-10" />
              <div>Member</div>
              <div>Role</div>
              <div>Status</div>
              <div>Joined</div>
            </div>
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--light)]">No team members found.</div>
            ) : (
              filtered.map((u) => (
                <div
                  key={u.id}
                  onClick={() => setSelectedMember(u)}
                  className="grid grid-cols-[auto_2fr_1fr_1fr_1fr] items-center gap-0 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--bg)] cursor-pointer"
                >
                  <div className="w-10">
                    {u.photoUrl ? (
                      <img src={u.photoUrl} alt={u.name} className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-700 text-white"
                        style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
                      >
                        {initials(u.name)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-600 text-[var(--black)]">
                      {u.name}
                      {u.id === currentUser?.uid && (
                        <span className="ml-1.5 text-[9px] text-[var(--light)]">(you)</span>
                      )}
                    </p>
                    <p className="truncate text-[10px] text-[var(--light)]">{u.email}</p>
                  </div>
                  <div>
                    {isSuperAdmin && u.role !== 'super_admin' ? (
                      <select
                        value={u.role}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => changeRole(u.id, e.target.value as StaffRole)}
                        className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[10px] outline-none focus:border-[var(--green)]"
                      >
                        {(Object.keys(STAFF_ROLE_LABELS) as StaffRole[])
                          .filter((r) => r !== 'super_admin')
                          .map((r) => (
                            <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>
                          ))}
                      </select>
                    ) : (
                      <Badge
                        label={STAFF_ROLE_LABELS[u.role] ?? u.role}
                        variant={roleBadgeVariant(u.role)}
                      />
                    )}
                  </div>
                  <div>
                    <span
                      className={`text-[10px] font-600 ${
                        u.status === 'suspended' ? 'text-red-500' : 'text-emerald-600'
                      }`}
                    >
                      {u.status === 'suspended' ? 'Suspended' : 'Active'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[var(--light)]">{fmtDate(u.createdAt)}</span>
                    {isSuperAdmin && u.role !== 'super_admin' && u.id !== currentUser?.uid && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSuspend(u);
                        }}
                        title={u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                        className="rounded p-1 text-[var(--light)] hover:text-red-500"
                      >
                        {u.status === 'suspended' ? (
                          <UserCheck className="h-3.5 w-3.5" />
                        ) : (
                          <UserX className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <h3 className="mb-3 text-sm font-600 text-[var(--black)]">
              Pending invites ({invites.length})
            </h3>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--border)] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                      <Mail className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-xs font-600 text-[var(--black)]">{inv.email}</p>
                      <p className="text-[10px] text-[var(--light)]">
                        Invited as {STAFF_ROLE_LABELS[inv.role]} · {fmtDate(inv.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Badge label="Pending" variant="amber" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Invite modal */}
      <Modal open={inviteModal} onClose={closeInviteModal} title="Invite team member" size="md">
        {!generatedLink ? (
          <>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Email address *
                </label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="name@nearwork.co"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
                />
                <p className="mt-1 text-[10px] text-[var(--light)]">
                  Only @nearwork.co addresses can be invited.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Role *
                </label>
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as StaffRole }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
                >
                  {(Object.entries(STAFF_ROLE_LABELS) as [StaffRole, string][])
                    .filter(([r]) => r !== 'super_admin' && r !== 'user' && r !== 'employee')
                    .map(([r, label]) => (
                      <option key={r} value={r}>{label}</option>
                    ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeInviteModal}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]"
              >
                Cancel
              </button>
              <button
                onClick={sendInvite}
                disabled={inviting}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
                style={{ background: 'var(--green)' }}
              >
                {inviting && <Spinner size="sm" />}
                Create invite link
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-600 text-emerald-700">Invite link created</p>
              <p className="mt-0.5 text-[10px] text-emerald-600">
                Share this link with {inviteForm.email}. It expires in 7 days.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
              <p className="flex-1 truncate text-[10px] text-[var(--mid)]">{generatedLink}</p>
              <button
                onClick={copyLink}
                className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-[10px] font-600 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={closeInviteModal}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Member profile */}
      <Modal
        open={!!selectedMember}
        onClose={() => setSelectedMember(null)}
        title="Team member"
        size="md"
      >
        {selectedMember && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              {selectedMember.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedMember.photoUrl}
                  alt={selectedMember.name}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-800 text-white"
                  style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
                >
                  {initials(selectedMember.name)}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-lg font-700 text-[var(--black)]">
                  {selectedMember.name}
                  {selectedMember.id === currentUser?.uid && (
                    <span className="ml-1.5 text-[10px] text-[var(--light)]">(you)</span>
                  )}
                </p>
                <div className="mt-1">
                  <Badge
                    label={STAFF_ROLE_LABELS[selectedMember.role] ?? selectedMember.role}
                    variant={roleBadgeVariant(selectedMember.role)}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 text-xs">
              <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
                <span className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Email
                </span>
                <a
                  href={`mailto:${selectedMember.email}`}
                  className="font-600 text-[var(--green)] hover:underline"
                >
                  {selectedMember.email}
                </a>
              </div>
              {selectedMember.calendlyLink && (
                <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
                  <span className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                    Calendly
                  </span>
                  <a
                    href={
                      selectedMember.calendlyLink.startsWith('http')
                        ? selectedMember.calendlyLink
                        : `https://${selectedMember.calendlyLink}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-600 text-[var(--green)] hover:underline"
                  >
                    Book time →
                  </a>
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
                <span className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Status
                </span>
                <span
                  className={`font-600 ${
                    selectedMember.status === 'suspended' ? 'text-red-500' : 'text-emerald-600'
                  }`}
                >
                  {selectedMember.status === 'suspended' ? 'Suspended' : 'Active'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
                <span className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Joined
                </span>
                <span className="font-600 text-[var(--black)]">
                  {fmtDate(selectedMember.createdAt) || '—'}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <a
                href={`mailto:${selectedMember.email}`}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white"
                style={{ background: 'var(--green)' }}
              >
                <Mail className="h-3.5 w-3.5" />
                Reach out
              </a>
            </div>
          </div>
        )}
      </Modal>
    </MainLayout>
  );
}
