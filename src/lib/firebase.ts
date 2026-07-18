import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  Timestamp,
  FieldValue,
  arrayUnion,
  arrayRemove,
  increment,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  OAuthProvider,
  signInWithPopup,
  linkWithCredential,
  type User,
  type UserCredential,
  type OAuthCredential,
} from 'firebase/auth';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyApRNyW8PoP28E0x77dUB5jOgHuTqA2by4',
  authDomain: 'nearwork-97e3c.firebaseapp.com',
  projectId: 'nearwork-97e3c',
  storageBucket: 'nearwork-97e3c.firebasestorage.app',
  messagingSenderId: '145642656516',
  appId: '1:145642656516:web:0ac2da8931283121e87651',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// ─── Role helpers ─────────────────────────────────────────────────────────────

import type { StaffRole } from './types';
export type { StaffRole };

const STAFF_ROLES: StaffRole[] = [
  'super_admin', 'admin', 'recruiter', 'sales', 'hr', 'employee', 'user',
];

// Super admin status is driven by the `role: 'super_admin'` field in each
// user's Firestore profile — set once via the Firebase console or Admin UI.
// No email addresses are hardcoded here to keep them out of the source bundle.
export const HARD_CODED_SUPER_ADMINS: string[] = [];

// ─── Microsoft (Entra) sign-in ────────────────────────────────────────────────
// Firebase Auth stays the identity system: Firestore rules key off the Firebase
// uid, so Microsoft is added as a sign-in *provider* rather than replacing auth.
// The tenant parameter pins the login to the Nearwork directory, so a personal
// or other-company Microsoft account can't sign in even if it knows the URL.

// Nearwork's Entra directory (tenant) id. Not a secret — it only identifies the
// organization, and pinning to it is what stops personal or other-company
// Microsoft accounts from signing in. Overridable by env for other environments.
const NEARWORK_TENANT_ID = 'dd9750f0-80f2-4b2b-8b65-15219d6e80f1';
const MS_TENANT_ID = process.env.NEXT_PUBLIC_MS_TENANT_ID || NEARWORK_TENANT_ID;

export function microsoftProvider(): OAuthProvider {
  const provider = new OAuthProvider('microsoft.com');
  provider.setCustomParameters({
    // Restrict to the Nearwork org. Falls back to 'organizations' (any work
    // account, no personal ones) if the tenant id hasn't been configured yet —
    // the @nearwork.co check below still applies either way.
    tenant: MS_TENANT_ID || 'organizations',
    prompt: 'select_account',
  });
  provider.addScope('openid');
  provider.addScope('email');
  provider.addScope('profile');
  return provider;
}

// Existing Admin accounts sign in with a password, and Firebase allows only one
// account per email address. So the first Microsoft sign-in for an existing user
// is rejected with 'account-exists-with-different-credential'. We stash the
// Microsoft credential, ask them to confirm with their password once, then
// attach Microsoft to the same account — keeping their uid, and therefore all
// their data and permissions, intact.
let pendingMicrosoftCred: OAuthCredential | null = null;

export class MicrosoftNeedsLinkError extends Error {
  emailToLink: string;
  constructor(emailToLink: string) {
    super('needs_password_link');
    this.name = 'MicrosoftNeedsLinkError';
    this.emailToLink = emailToLink;
  }
}

export async function signInWithMicrosoft(): Promise<UserCredential> {
  try {
    const cred = await signInWithPopup(auth, microsoftProvider());
    // Belt and braces: even with the tenant pinned, never let a non-Nearwork
    // address hold a session in Admin.
    if (!isNearworkEmail(cred.user.email ?? '')) {
      await signOut(auth);
      throw new Error('not_nearwork');
    }
    return cred;
  } catch (err) {
    const e = err as { code?: string; customData?: { email?: string } };
    if (e.code === 'auth/account-exists-with-different-credential') {
      pendingMicrosoftCred = OAuthProvider.credentialFromError(err as Parameters<typeof OAuthProvider.credentialFromError>[0]);
      throw new MicrosoftNeedsLinkError(e.customData?.email ?? '');
    }
    throw err;
  }
}

export function hasPendingMicrosoftLink(): boolean {
  return pendingMicrosoftCred !== null;
}

/** Attach a stashed Microsoft identity to the account that just signed in with a
 *  password. After this they can use the Microsoft button from then on. */
export async function linkPendingMicrosoft(user: User): Promise<boolean> {
  if (!pendingMicrosoftCred) return false;
  try {
    await linkWithCredential(user, pendingMicrosoftCred);
    return true;
  } catch {
    // Already linked, or the link was refused — not worth blocking the sign-in
    // they already completed successfully.
    return false;
  } finally {
    pendingMicrosoftCred = null;
  }
}

export function isNearworkEmail(email: string): boolean {
  return String(email ?? '')
    .trim()
    .toLowerCase()
    .endsWith('@nearwork.co');
}

export function normalizeStaffRole(role: string): StaffRole {
  const value = String(role ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
  if (value === 'super_admin') return 'super_admin';
  if (value === 'sr_recruiter' || value === 'senior_recruiter') return 'recruiter';
  if (value === 'account_manager') return 'sales';
  if (value === 'users') return 'employee';
  if ((STAFF_ROLES as string[]).includes(value)) return value as StaffRole;
  return 'employee';
}

export function isAdminRole(role: string): boolean {
  return (STAFF_ROLES as string[]).includes(normalizeStaffRole(role));
}

// ─── User profile helpers ─────────────────────────────────────────────────────

export async function getUserProfile(uid: string): Promise<(DocumentData & { id: string }) | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) return { id: snap.id, ...snap.data() } as DocumentData & { id: string };
    return null;
  } catch (e) {
    console.error('getUserProfile error:', e);
    return null;
  }
}

export async function saveUserProfile(uid: string, data: DocumentData) {
  return setDoc(doc(db, 'users', uid), data, { merge: true });
}

export async function ensureStaffUserProfile(user: User) {
  const email = String(user?.email ?? '')
    .trim()
    .toLowerCase();
  if (!user || !isNearworkEmail(email)) return null;
  const profile = await getUserProfile(user.uid);
  const role = HARD_CODED_SUPER_ADMINS.includes(email)
    ? 'super_admin'
    : normalizeStaffRole(profile?.role ?? 'employee');
  const displayName =
    user.displayName ?? profile?.name ?? email.split('@')[0];
  const data: DocumentData = {
    email,
    name: profile?.name ?? displayName,
    firstName: profile?.firstName ?? displayName.split(' ')[0] ?? '',
    lastName:
      profile?.lastName ?? displayName.split(' ').slice(1).join(' '),
    role,
    staffRole: role,
    source: profile?.source ?? 'admin.nearwork.co',
    status: profile?.status ?? 'active',
    updatedAt: serverTimestamp(),
  };
  if (!profile) data.createdAt = serverTimestamp();
  await saveUserProfile(user.uid, data);
  return { id: user.uid, ...(profile ?? {}), ...data };
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export {
  db,
  auth,
  storage,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  OAuthProvider,
  signInWithPopup,
  serverTimestamp,
  Timestamp,
  FieldValue,
  arrayUnion,
  arrayRemove,
  increment,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  onSnapshot,
  ref,
  uploadBytes,
  getDownloadURL,
  type User,
  type DocumentData,
  type QueryConstraint,
};
