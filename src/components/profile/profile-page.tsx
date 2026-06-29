'use client';

import { useState, useRef, useEffect } from 'react';
import {
  db,
  storage,
  auth,
  doc,
  updateDoc,
  serverTimestamp,
  ref,
  uploadBytes,
  getDownloadURL,
  sendPasswordResetEmail,
} from '@/lib/firebase';
import { MainLayout } from '@/components/layout/main-layout';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/use-auth';
import { initials, fmtDate } from '@/lib/utils';
import { STAFF_ROLE_LABELS } from '@/lib/types';
import type { StaffRole } from '@/lib/types';
import { Camera, Link as LinkIcon } from 'lucide-react';
import { NW, Icon, Avatar, Button, Chip } from '@/components/nw/primitives';
import { PageHeader, Card } from '@/components/nw/shell-ui';

export default function ProfilePage() {
  const { showToast } = useToast();
  const { user, profile, loading } = useAuth();

  const [form, setForm] = useState({
    name: '',
    firstName: '',
    lastName: '',
    calendlyLink: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sync form when profile loads
  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name ?? '',
        firstName: profile.firstName ?? '',
        lastName: profile.lastName ?? '',
        calendlyLink: profile.calendlyLink ?? '',
      });
    }
  }, [profile]);

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        name: form.name.trim() || `${form.firstName} ${form.lastName}`.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        calendlyLink: form.calendlyLink.trim(),
        updatedAt: serverTimestamp(),
      });
      showToast('Profile updated', 'success');
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!user) return;
    setUploadingPhoto(true);
    try {
      const storageRef = ref(storage, `users/${user.uid}/avatar`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', user.uid), { photoUrl: url, updatedAt: serverTimestamp() });
      setPhotoPreview(url);
      showToast('Photo updated', 'success');
    } catch {
      showToast('Failed to upload photo', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function sendReset() {
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      showToast('Password reset email sent', 'success');
    } catch {
      showToast('Failed to send reset email', 'error');
    }
  }

  if (loading) {
    return (
      <MainLayout>
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      </MainLayout>
    );
  }

  const displayPhoto = photoPreview ?? profile?.photoUrl;
  const displayName = form.name || (user?.email?.split('@')[0] ?? 'Admin');

  return (
    <MainLayout>
      <div>
        <PageHeader overline="Account" title="Profile" subtitle="Manage your personal information and how candidates reach you." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 16, alignItems: 'start' }}>
          {/* Left — identity card */}
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '8px 0 4px' }}>
              <div style={{ position: 'relative' }}>
                {displayPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayPhoto} alt={displayName} style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <Avatar initials={initials(displayName) || '—'} size={84} bg={NW.teal500} />
                )}
                <button onClick={() => fileRef.current?.click()} disabled={uploadingPhoto} title="Change photo"
                  style={{ position: 'absolute', bottom: -2, right: -2, width: 28, height: 28, borderRadius: '50%', border: `2px solid ${NW.white}`, background: NW.teal500, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  {uploadingPhoto ? <Spinner size="sm" /> : <Camera className="h-3.5 w-3.5" />}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) { setPhotoPreview(URL.createObjectURL(file)); uploadPhoto(file); } }} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 14, color: NW.black }}>{displayName}</div>
              <div style={{ fontSize: 13.5, color: NW.gray500, marginTop: 3 }}>{user?.email}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <Chip variant="accent" size="md" icon="shield-check">{STAFF_ROLE_LABELS[profile?.role as StaffRole] ?? profile?.role ?? 'Staff'}</Chip>
              </div>
            </div>
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${NW.gray100}`, display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, fontSize: 13, color: NW.gray600 }}><Icon name="mail" size={15} color={NW.gray400} />{user?.email}</div>
              {profile?.calendlyLink && <div style={{ display: 'flex', alignItems: 'center', gap: 11, fontSize: 13, color: NW.gray600 }}><Icon name="calendar" size={15} color={NW.gray400} />Calendly connected</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, fontSize: 13, color: NW.gray600 }}><Icon name="calendar-check" size={15} color={NW.gray400} />Joined {fmtDate(profile?.createdAt) || '—'}</div>
            </div>
            <Button variant="secondary" size="md" icon="lock" fullWidth style={{ marginTop: 20 }} onClick={sendReset}>Reset password</Button>
          </Card>

          {/* Right — editable personal information */}
          <Card>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: NW.black, marginBottom: 16 }}>Personal information</h2>
            <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                First name
              </label>
              <input
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                placeholder="Jane"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                Last name
              </label>
              <input
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                placeholder="Doe"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                Display name
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jane Doe"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 flex items-center gap-1.5 text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                <LinkIcon className="h-3 w-3" />
                Calendly link
              </label>
              <input
                value={form.calendlyLink}
                onChange={(e) => setForm((f) => ({ ...f, calendlyLink: e.target.value }))}
                placeholder="https://calendly.com/your-name"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
              />
              <p className="mt-1 text-[10px] text-[var(--light)]">
                Shown to candidates when scheduling. Visible only to candidates your team is managing.
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              onClick={saveProfile}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-600 text-white disabled:opacity-60"
              style={{ background: 'var(--green)' }}
            >
              {saving && <Spinner size="sm" />}
              Save changes
            </button>
          </div>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
