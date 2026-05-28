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
import { Badge } from '@/components/ui/badge';
import { initials } from '@/lib/utils';
import { STAFF_ROLE_LABELS } from '@/lib/types';
import type { StaffRole } from '@/lib/types';
import { Camera, Link as LinkIcon, Lock } from 'lucide-react';

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
      <div className="max-w-2xl space-y-5">
        <div>
          <h1 className="text-xl font-700 tracking-tight text-[var(--black)]">My Profile</h1>
          <p className="mt-0.5 text-xs text-[var(--light)]">Manage your personal information</p>
        </div>

        {/* Avatar + role */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="flex items-center gap-5">
            <div className="relative">
              {displayPhoto ? (
                <img
                  src={displayPhoto}
                  alt={displayName}
                  className="h-20 w-20 rounded-full object-cover"
                />
              ) : (
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-800 text-white"
                  style={{ background: 'linear-gradient(135deg, var(--green), var(--gd))' }}
                >
                  {initials(displayName)}
                </div>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadingPhoto}
                className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[var(--green)] text-white hover:bg-[var(--gd)]"
                title="Change photo"
              >
                {uploadingPhoto ? <Spinner size="sm" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setPhotoPreview(URL.createObjectURL(file));
                    uploadPhoto(file);
                  }
                }}
              />
            </div>
            <div>
              <p className="text-base font-700 text-[var(--black)]">{displayName}</p>
              <p className="text-xs text-[var(--light)]">{user?.email}</p>
              <div className="mt-1.5">
                <Badge
                  label={STAFF_ROLE_LABELS[profile?.role as StaffRole] ?? profile?.role ?? 'Staff'}
                  variant="green"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Edit form */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="mb-4 text-sm font-600 text-[var(--black)]">Personal information</h2>
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
        </div>

        {/* Password */}
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-600 text-[var(--black)]">Password</h2>
              <p className="mt-0.5 text-xs text-[var(--light)]">
                We&apos;ll send a reset link to {user?.email}
              </p>
            </div>
            <button
              onClick={sendReset}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <Lock className="h-3.5 w-3.5" />
              Reset password
            </button>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
